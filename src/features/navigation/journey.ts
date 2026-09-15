import { haversineKm, kmToMiles } from '../../lib/distance';
import { isStationSnapshotStale } from '../../lib/gbfs';
import { rankStations } from '../../lib/stations';
import type { TripDestination, TripLeg, TripPlan } from '../../lib/tripPlanner';
import type { LatLon, Station, StationSnapshot } from '../../types';

export type NavigationStage = 'pickup' | 'ride' | 'destination' | 'complete';
export type RerouteMode = 'ask' | 'automatic';
export type LocationMode = 'manual' | 'device';

export interface Journey {
  version: 1;
  id: string;
  origin: LatLon;
  destination: TripDestination | null;
  pickup: Station;
  dropoff: Station | null;
  stage: NavigationStage;
  rerouteMode: RerouteMode;
  locationMode: LocationMode;
  startedAt: number;
  updatedAt: number;
}

export interface StationChange {
  kind: 'pickup' | 'dropoff';
  previous: Station;
  replacement: Station | null;
  alternatives: Station[];
  reason: 'no-bikes' | 'no-docks' | 'unavailable';
}

function journeyId(now: number): string {
  return globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`;
}

function baseJourney(
  origin: LatLon,
  pickup: Station,
  destination: TripDestination | null,
  dropoff: Station | null,
  mode: RerouteMode,
  now: number,
  locationMode: LocationMode,
): Journey {
  return {
    version: 1,
    id: journeyId(now),
    origin: { ...origin },
    destination: destination ? { ...destination } : null,
    pickup: { ...pickup },
    dropoff: dropoff ? { ...dropoff } : null,
    stage: 'pickup',
    rerouteMode: mode,
    locationMode,
    startedAt: now,
    updatedAt: now,
  };
}

export function createJourney(
  plan: TripPlan,
  mode: RerouteMode = 'ask',
  now = Date.now(),
  locationMode: LocationMode = 'manual',
): Journey {
  return baseJourney(
    plan.legs[0].from,
    plan.pickup,
    plan.legs[2].to,
    plan.dropoff,
    mode,
    now,
    locationMode,
  );
}

export function createPickupJourney(
  origin: LatLon,
  pickup: Station,
  mode: RerouteMode = 'ask',
  now = Date.now(),
  locationMode: LocationMode = 'manual',
): Journey {
  return baseJourney(origin, pickup, null, null, mode, now, locationMode);
}

export function getAvailableJourneyStages(journey: Journey): NavigationStage[] {
  const stages: NavigationStage[] = ['pickup'];
  if (journey.dropoff) stages.push('ride');
  if (journey.dropoff && journey.destination) stages.push('destination');
  return stages;
}

export function setJourneyStage(
  journey: Journey,
  stage: NavigationStage,
  now = Date.now(),
): Journey {
  if (stage === journey.stage) return journey;
  const supported =
    stage === 'complete'
      ? Boolean(journey.dropoff && journey.destination)
      : getAvailableJourneyStages(journey).includes(stage);
  return supported ? { ...journey, stage, updatedAt: now } : journey;
}

function stationPoint(station: Station): LatLon {
  return { lat: station.lat, lon: station.lon };
}

function activeLegEndpoints(journey: Journey): {
  title: TripLeg['title'];
  mode: TripLeg['mode'];
  from: LatLon;
  to: LatLon;
  fromDescription: string;
  toDescription: string;
} {
  if (journey.stage === 'pickup') {
    return {
      title: 'Walk to pickup',
      mode: 'walking',
      from: journey.origin,
      to: stationPoint(journey.pickup),
      fromDescription: journey.locationMode === 'device' ? 'Current location' : 'Starting location',
      toDescription: journey.pickup.name,
    };
  }

  if (journey.stage === 'ride') {
    if (!journey.dropoff) throw new Error('Ride navigation requires a drop-off station.');
    return {
      title: 'Ride to dropoff',
      mode: 'bicycling',
      from: stationPoint(journey.pickup),
      to: stationPoint(journey.dropoff),
      fromDescription: journey.pickup.name,
      toDescription: journey.dropoff.name,
    };
  }

  if (!journey.dropoff || !journey.destination) {
    throw new Error('Destination navigation requires a drop-off station and destination.');
  }
  return {
    title: 'Walk to destination',
    mode: 'walking',
    from: stationPoint(journey.dropoff),
    to: journey.destination,
    fromDescription: journey.dropoff.name,
    toDescription: journey.destination.label?.trim() || 'Destination',
  };
}

export function getJourneyLeg(journey: Journey, position?: LatLon | null): TripLeg {
  const endpoints = activeLegEndpoints(journey);
  const livePosition = journey.locationMode === 'device' ? position : null;
  const from = livePosition ? { ...livePosition } : { ...endpoints.from };
  return {
    ...endpoints,
    from,
    to: { ...endpoints.to },
    fromDescription: livePosition ? 'Current location' : endpoints.fromDescription,
    distanceMi: kmToMiles(haversineKm(from, endpoints.to)),
  };
}

type StationChangeKind = StationChange['kind'];

function isValidPoint(point: LatLon | null | undefined): point is LatLon {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

function selectedStationReason(
  kind: StationChangeKind,
  selected: Station | undefined,
): StationChange['reason'] | null {
  if (!selected || !selected.is_installed) return 'unavailable';
  if (kind === 'pickup') {
    if (!selected.is_renting) return 'unavailable';
    return selected.num_bikes_available > 0 ? null : 'no-bikes';
  }
  if (!selected.is_returning) return 'unavailable';
  return selected.num_docks_available > 0 ? null : 'no-docks';
}

function stationChange(
  journey: Journey,
  snapshot: StationSnapshot,
  kind: StationChangeKind,
  point: LatLon,
): StationChange | null {
  const previous = kind === 'pickup' ? journey.pickup : journey.dropoff;
  if (!previous) return null;
  const selected = snapshot.stations.find((station) => station.station_id === previous.station_id);
  const reason = selectedStationReason(kind, selected);
  if (!reason) return null;

  const ranked = rankStations(snapshot.stations, point, {
    kind,
    excludeStationId: previous.station_id,
    limit: snapshot.stations.length,
  })
    .map((candidate) => candidate.station)
    .filter((station) => station.station_id !== previous.station_id);
  const incompatibleId =
    kind === 'pickup' ? journey.dropoff?.station_id : journey.pickup.station_id;
  const compatible = incompatibleId
    ? ranked.filter((station) => station.station_id !== incompatibleId)
    : ranked;
  const alternatives = (compatible.length > 0 ? compatible : ranked).slice(0, 3);

  return {
    kind,
    previous,
    replacement: alternatives[0] ?? null,
    alternatives,
    reason,
  };
}

export function findStationChange(
  journey: Journey,
  snapshot: StationSnapshot | null,
  position?: LatLon | null,
  now = Date.now(),
): StationChange | null {
  if (
    !snapshot ||
    snapshot.isStale ||
    isStationSnapshotStale(snapshot, now) ||
    journey.stage === 'destination' ||
    journey.stage === 'complete'
  ) {
    return null;
  }

  if (journey.stage === 'pickup') {
    const pickupChange = stationChange(
      journey,
      snapshot,
      'pickup',
      isValidPoint(position) ? position : journey.origin,
    );
    if (pickupChange) return pickupChange;
  }

  return journey.dropoff && journey.destination
    ? stationChange(journey, snapshot, 'dropoff', journey.destination)
    : null;
}

export function applyStationChange(
  journey: Journey,
  change: StationChange,
  now = Date.now(),
): Journey {
  if (!change.replacement) return journey;
  if (change.kind === 'pickup' && journey.stage !== 'pickup') return journey;
  if (change.kind === 'dropoff' && journey.stage !== 'pickup' && journey.stage !== 'ride') {
    return journey;
  }
  const selected = change.kind === 'pickup' ? journey.pickup : journey.dropoff;
  if (!selected || selected.station_id !== change.previous.station_id) return journey;
  return {
    ...journey,
    [change.kind]: { ...change.replacement },
    updatedAt: now,
  };
}
