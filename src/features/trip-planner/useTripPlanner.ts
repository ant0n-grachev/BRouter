import { useCallback, useMemo, useState } from 'react';
import { useDeviceLocation } from '../../hooks/useDeviceLocation';
import { computeStationServiceArea, isPointWithinStationServiceArea } from '../../lib/coverage';
import { MAX_STATION_DISTANCE_MILES, rankStations, type RankedStation } from '../../lib/stations';
import { createTripPlan, type TripDestination, type TripPlan } from '../../lib/tripPlanner';
import type { LatLon, Station } from '../../types';

export type OriginMode = 'manual' | 'device';

const missingServiceAreaNotice =
  'Live station data is not available to validate your device location. Enter a starting location instead.';
const outsideServiceAreaNotice =
  'Your device location is outside the current BCycle service area. Enter a starting location instead.';

function deviceLocationValidationKey(
  serviceArea: ReturnType<typeof computeStationServiceArea>,
  location: LatLon,
): string {
  return `${location.lat},${location.lon}|${serviceArea?.cacheKey ?? 'no-service-area'}`;
}

function deviceLocationFallbackNotice(
  serviceArea: ReturnType<typeof computeStationServiceArea>,
  location: LatLon,
): string | null {
  if (!serviceArea) return missingServiceAreaNotice;
  return isPointWithinStationServiceArea(serviceArea, location) ? null : outsideServiceAreaNotice;
}

function selectedCandidate(
  candidates: RankedStation[],
  selectedId: string | null,
): RankedStation | null {
  return (
    candidates.find((candidate) => candidate.station.station_id === selectedId) ??
    candidates[0] ??
    null
  );
}

function allStationsUnavailable(stations: Station[]): boolean {
  return (
    stations.length > 0 &&
    stations.every(
      (station) => !station.is_installed || (!station.is_renting && !station.is_returning),
    )
  );
}

function pickupIssueFor(stations: Station[], origin: LatLon | null): string | null {
  if (origin === null) return null;
  if (allStationsUnavailable(stations)) return 'All stations are currently unavailable.';

  const hasAvailableBike = stations.some(
    (station) => station.is_installed && station.is_renting && station.num_bikes_available > 0,
  );
  if (!hasAvailableBike) {
    return 'No bikes are currently available at installed rental stations.';
  }

  return `No pickup station is within ${MAX_STATION_DISTANCE_MILES.toFixed(1)} mile. This location is outside the approximate Madison BCycle station coverage.`;
}

function dropoffIssueFor(stations: Station[], destination: TripDestination | null): string | null {
  if (destination === null) return null;
  if (allStationsUnavailable(stations)) return 'All stations are currently unavailable.';

  const hasAvailableDock = stations.some(
    (station) => station.is_installed && station.is_returning && station.num_docks_available > 0,
  );
  if (!hasAvailableDock) {
    return 'No docks are currently available at installed return stations.';
  }

  return `No drop-off station is within ${MAX_STATION_DISTANCE_MILES.toFixed(1)} mile. This location is outside the approximate Madison BCycle station coverage.`;
}

export function useTripPlanner(stations: Station[]) {
  const [originMode, setOriginModeState] = useState<OriginMode>('manual');
  const [originModeNotice, setOriginModeNotice] = useState<string | null>(null);
  const [lastDeviceValidationKey, setLastDeviceValidationKey] = useState<string | null>(null);
  const [manualOrigin, setManualOriginState] = useState<LatLon | null>(null);
  const [destination, setDestinationState] = useState<TripDestination | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [originSearchKey, setOriginSearchKey] = useState(0);
  const [destinationSearchKey, setDestinationSearchKey] = useState(0);
  const [selectedPickupId, selectPickup] = useState<string | null>(null);
  const [selectedDropoffId, selectDropoff] = useState<string | null>(null);
  const serviceArea = useMemo(() => computeStationServiceArea(stations), [stations]);

  const setManualOrigin = useCallback((nextOrigin: LatLon | null) => {
    setOriginModeState('manual');
    setOriginModeNotice(null);
    setManualOriginState(nextOrigin);
    selectPickup(null);
    selectDropoff(null);
  }, []);

  const setDestination = useCallback((nextDestination: TripDestination | null) => {
    setDestinationState(nextDestination);
    selectDropoff(null);
  }, []);

  const handleDeviceLocation = useCallback(
    (location: LatLon) => {
      selectPickup(null);
      selectDropoff(null);
      setLastDeviceValidationKey(deviceLocationValidationKey(serviceArea, location));
      const fallbackNotice = deviceLocationFallbackNotice(serviceArea, location);
      if (fallbackNotice) {
        setOriginModeState('manual');
        setOriginText('');
        setOriginModeNotice(fallbackNotice);
      }
    },
    [serviceArea],
  );
  const deviceLocation = useDeviceLocation({
    enabled: originMode === 'device',
    onLocation: handleDeviceLocation,
  });
  const retryDeviceLocation = deviceLocation.retry;

  if (originMode === 'device' && deviceLocation.location) {
    const validationKey = deviceLocationValidationKey(serviceArea, deviceLocation.location);
    if (validationKey !== lastDeviceValidationKey) {
      setLastDeviceValidationKey(validationKey);
      const fallbackNotice = deviceLocationFallbackNotice(serviceArea, deviceLocation.location);
      if (fallbackNotice) {
        setOriginModeState('manual');
        setOriginText('');
        setOriginModeNotice(fallbackNotice);
      }
    }
  }

  const setOriginMode = useCallback((mode: OriginMode) => {
    setOriginModeNotice(null);
    setOriginModeState(mode);
    selectPickup(null);
    selectDropoff(null);
  }, []);

  const useCurrentLocation = useCallback(() => {
    setOriginModeNotice(null);
    setManualOriginState(null);
    setOriginModeState('device');
    setOriginText('My location');
    setOriginSearchKey((key) => key + 1);
    selectPickup(null);
    selectDropoff(null);
    if (originMode === 'device') retryDeviceLocation();
  }, [retryDeviceLocation, originMode]);

  const clear = useCallback(() => {
    setOriginModeState('manual');
    setOriginModeNotice(null);
    setLastDeviceValidationKey(null);
    setManualOriginState(null);
    setDestinationState(null);
    setOriginText('');
    setDestinationText('');
    setOriginSearchKey((key) => key + 1);
    setDestinationSearchKey((key) => key + 1);
    selectPickup(null);
    selectDropoff(null);
  }, []);

  const origin = originMode === 'device' ? deviceLocation.location : manualOrigin;

  const pickupCandidates = useMemo(
    () => (origin === null ? [] : rankStations(stations, origin, { kind: 'pickup' })),
    [origin, stations],
  );
  const selectedPickup = selectedCandidate(pickupCandidates, selectedPickupId);
  const dropoffCandidates = useMemo(
    () =>
      destination === null || selectedPickup === null
        ? []
        : rankStations(stations, destination, {
            kind: 'dropoff',
            excludeStationId: selectedPickup.station.station_id,
          }),
    [destination, selectedPickup, stations],
  );
  const selectedDropoff = selectedCandidate(dropoffCandidates, selectedDropoffId);

  const plan = useMemo<TripPlan | null>(
    () =>
      origin !== null && destination !== null && selectedPickup !== null && selectedDropoff !== null
        ? createTripPlan(origin, destination, selectedPickup.station, selectedDropoff.station)
        : null,
    [destination, origin, selectedDropoff, selectedPickup],
  );

  return {
    originMode,
    setOriginMode,
    useCurrentLocation,
    clear,
    originText,
    setOriginText,
    destinationText,
    setDestinationText,
    originSearchKey,
    destinationSearchKey,
    originModeNotice,
    serviceArea,
    manualOrigin,
    setManualOrigin,
    destination,
    setDestination,
    origin,
    deviceLocation,
    pickupCandidates,
    dropoffCandidates,
    selectedPickup,
    selectedDropoff,
    selectPickup,
    selectDropoff,
    pickupIssue:
      origin !== null && pickupCandidates.length === 0 ? pickupIssueFor(stations, origin) : null,
    dropoffIssue:
      destination !== null && selectedPickup !== null && dropoffCandidates.length === 0
        ? dropoffIssueFor(stations, destination)
        : null,
    plan,
  };
}
