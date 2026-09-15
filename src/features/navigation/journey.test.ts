import { createTripPlan } from '../../lib/tripPlanner';
import type { Station, StationSnapshot } from '../../types';
import {
  applyStationChange,
  createJourney,
  createPickupJourney,
  findStationChange,
  getAvailableJourneyStages,
  getJourneyLeg,
  setJourneyStage,
  type Journey,
} from './journey';

const NOW = 1_800_000_000_000;
const ORIGIN = { lat: 43.0731, lon: -89.4012 };
const DESTINATION = { lat: 43.081, lon: -89.39, label: 'Destination address' };

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    name: id,
    lat: 43.074,
    lon: -89.4,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 4,
    num_docks_available: 5,
    ...overrides,
  };
}

function plan() {
  return createTripPlan(
    ORIGIN,
    DESTINATION,
    station('pickup'),
    station('dropoff', { lat: 43.08, lon: -89.391 }),
  );
}

function fullJourney(stage: Journey['stage'] = 'pickup'): Journey {
  return { ...createJourney(plan(), 'ask', NOW), id: 'journey-id', stage };
}

function pickupJourney(): Journey {
  return {
    ...createPickupJourney(ORIGIN, station('pickup'), 'ask', NOW),
    id: 'pickup-journey-id',
  };
}

function snapshot(stations: Station[], overrides: Partial<StationSnapshot> = {}): StationSnapshot {
  return {
    stations,
    fetchedAt: NOW - 1_000,
    feedUpdatedAt: NOW - 1_000,
    ttlSeconds: 60,
    isStale: false,
    ...overrides,
  };
}

describe('journey lifecycle', () => {
  it('creates a full journey without handoff state', () => {
    const selectedPlan = plan();
    const created = createJourney(selectedPlan, undefined, NOW);

    expect(created).toMatchObject({
      version: 1,
      origin: ORIGIN,
      destination: DESTINATION,
      pickup: selectedPlan.pickup,
      dropoff: selectedPlan.dropoff,
      stage: 'pickup',
      rerouteMode: 'ask',
      locationMode: 'manual',
      startedAt: NOW,
      updatedAt: NOW,
    });
    expect(created).not.toHaveProperty('handoff');
    expect(created.id).toEqual(expect.any(String));
    expect(created.id).not.toHaveLength(0);
  });

  it('creates pickup-only navigation without inventing a destination or drop-off', () => {
    const pickup = station('pickup');
    const created = createPickupJourney(ORIGIN, pickup, 'automatic', NOW);

    expect(created).toMatchObject({
      origin: ORIGIN,
      pickup,
      destination: null,
      dropoff: null,
      stage: 'pickup',
      rerouteMode: 'automatic',
      locationMode: 'manual',
      startedAt: NOW,
      updatedAt: NOW,
    });
    expect(getAvailableJourneyStages(created)).toEqual(['pickup']);
  });

  it('marks device-origin full and pickup journeys for live navigation', () => {
    const full = createJourney(plan(), 'ask', NOW, 'device');
    const pickupOnly = createPickupJourney(ORIGIN, station('pickup'), 'ask', NOW, 'device');

    expect(full.locationMode).toBe('device');
    expect(pickupOnly.locationMode).toBe('device');
    expect(getJourneyLeg(pickupOnly).fromDescription).toBe('Current location');
  });

  it('switches directly among every full-trip leg without requiring an app handoff', () => {
    const pickup = fullJourney();
    const finalWalk = setJourneyStage(pickup, 'destination', NOW + 1);
    const ride = setJourneyStage(finalWalk, 'ride', NOW + 2);
    const walkAgain = setJourneyStage(ride, 'pickup', NOW + 3);

    expect(getAvailableJourneyStages(pickup)).toEqual(['pickup', 'ride', 'destination']);
    expect(finalWalk).toMatchObject({ stage: 'destination', updatedAt: NOW + 1 });
    expect(ride).toMatchObject({ stage: 'ride', updatedAt: NOW + 2 });
    expect(walkAgain).toMatchObject({ stage: 'pickup', updatedAt: NOW + 3 });
  });

  it('allows explicit completion but rejects stages whose required endpoints are missing', () => {
    const full = fullJourney('destination');
    expect(setJourneyStage(full, 'complete', NOW + 1)).toMatchObject({
      stage: 'complete',
      updatedAt: NOW + 1,
    });

    const pickupOnly = pickupJourney();
    expect(setJourneyStage(pickupOnly, 'pickup', NOW + 2)).toBe(pickupOnly);
    expect(setJourneyStage(pickupOnly, 'ride', NOW + 2)).toBe(pickupOnly);
    expect(setJourneyStage(pickupOnly, 'destination', NOW + 2)).toBe(pickupOnly);
    expect(setJourneyStage(pickupOnly, 'complete', NOW + 2)).toBe(pickupOnly);
  });

  it('preserves device location mode through stage and station changes', () => {
    const current = createJourney(plan(), 'ask', NOW, 'device');
    const replacement = station('replacement');
    const changedStation = applyStationChange(
      current,
      {
        kind: 'pickup',
        previous: current.pickup,
        replacement,
        alternatives: [replacement],
        reason: 'no-bikes',
      },
      NOW + 1,
    );

    expect(changedStation.locationMode).toBe('device');
    expect(setJourneyStage(changedStation, 'ride', NOW + 2).locationMode).toBe('device');
  });

  it('builds each full active leg directly and starts at a supplied live position', () => {
    const position = { lat: 43.076, lon: -89.397 };
    const current = { ...fullJourney('ride'), locationMode: 'device' as const };

    const storedLeg = getJourneyLeg(current);
    const { distanceMi: storedDistanceMi, ...storedLegWithoutDistance } = storedLeg;
    expect(storedLegWithoutDistance).toEqual({
      title: 'Ride to dropoff',
      mode: 'bicycling',
      from: { lat: current.pickup.lat, lon: current.pickup.lon },
      to: { lat: current.dropoff?.lat, lon: current.dropoff?.lon },
      fromDescription: 'pickup',
      toDescription: 'dropoff',
    });
    expect(storedDistanceMi).toBeGreaterThan(0);
    expect(getJourneyLeg(current, position)).toMatchObject({
      title: 'Ride to dropoff',
      mode: 'bicycling',
      from: position,
      to: { lat: current.dropoff?.lat, lon: current.dropoff?.lon },
      fromDescription: 'Current location',
    });
  });

  it('ignores live positions for manual-origin navigation', () => {
    const current = fullJourney('ride');

    expect(getJourneyLeg(current, { lat: 43.076, lon: -89.397 })).toMatchObject({
      from: { lat: current.pickup.lat, lon: current.pickup.lon },
      fromDescription: 'pickup',
    });
  });

  it('builds a real pickup leg for pickup-only navigation', () => {
    const current = pickupJourney();

    const leg = getJourneyLeg(current);
    const { distanceMi, ...legWithoutDistance } = leg;
    expect(legWithoutDistance).toEqual({
      title: 'Walk to pickup',
      mode: 'walking',
      from: ORIGIN,
      to: { lat: current.pickup.lat, lon: current.pickup.lon },
      fromDescription: 'Starting location',
      toDescription: 'pickup',
    });
    expect(distanceMi).toBeGreaterThan(0);
  });
});

describe('station changes', () => {
  it('detects an empty pickup and ranks eligible replacements near the supplied location', () => {
    const current = fullJourney();
    const unavailablePickup = station('pickup', { num_bikes_available: 0 });
    const nearPosition = { lat: 43.077, lon: -89.397 };
    const near = station('near', { lat: 43.0771, lon: -89.397 });
    const nearOriginButFarFromPosition = station('origin-near', {
      lat: 43.0732,
      lon: -89.4012,
    });

    const change = findStationChange(
      current,
      snapshot([unavailablePickup, current.dropoff!, near, nearOriginButFarFromPosition]),
      nearPosition,
      NOW,
    );

    expect(change).toMatchObject({
      kind: 'pickup',
      previous: current.pickup,
      replacement: near,
      reason: 'no-bikes',
    });
    expect(change?.alternatives.map((candidate) => candidate.station_id)).toEqual([
      'near',
      'origin-near',
    ]);
  });

  it('reroutes pickup-only navigation without checking a missing drop-off', () => {
    const current = pickupJourney();
    const replacement = station('replacement', { lat: 43.0733, lon: -89.401 });

    expect(
      findStationChange(
        current,
        snapshot([station('pickup', { num_bikes_available: 0 }), replacement]),
        undefined,
        NOW,
      ),
    ).toMatchObject({ kind: 'pickup', replacement, reason: 'no-bikes' });
  });

  it('checks drop-off only while it remains relevant to the selected leg', () => {
    const current = fullJourney('ride');
    const unavailableDropoff = station('dropoff', {
      lat: 43.08,
      lon: -89.391,
      num_docks_available: 0,
    });
    const replacement = station('replacement', {
      lat: 43.0805,
      lon: -89.3905,
      num_docks_available: 8,
    });
    const currentSnapshot = snapshot([
      station('pickup', { num_bikes_available: 0 }),
      unavailableDropoff,
      replacement,
    ]);

    expect(findStationChange(current, currentSnapshot, undefined, NOW)).toMatchObject({
      kind: 'dropoff',
      replacement,
      reason: 'no-docks',
    });
    expect(
      findStationChange({ ...current, stage: 'destination' }, currentSnapshot, undefined, NOW),
    ).toBeNull();
    expect(
      findStationChange({ ...current, stage: 'complete' }, currentSnapshot, undefined, NOW),
    ).toBeNull();
  });

  it('does not propose changes from either statically or dynamically stale feeds', () => {
    const unavailable = snapshot([station('pickup', { num_bikes_available: 0 })]);

    expect(
      findStationChange(fullJourney(), { ...unavailable, isStale: true }, undefined, NOW),
    ).toBeNull();
    expect(
      findStationChange(
        fullJourney(),
        { ...unavailable, feedUpdatedAt: NOW - 61_000 },
        undefined,
        NOW,
      ),
    ).toBeNull();
  });

  it('keeps dropoff alternatives inside the destination radius and avoids station conflicts', () => {
    const current = fullJourney('ride');
    const unavailableDropoff = station('dropoff', {
      lat: 43.08,
      lon: -89.391,
      is_returning: false,
    });
    const sameAsPickup = station('pickup', {
      lat: 43.0809,
      lon: -89.3901,
      num_docks_available: 10,
    });
    const distinct = station('distinct', {
      lat: 43.0807,
      lon: -89.3902,
      num_docks_available: 7,
    });
    const tooFar = station('too-far', { lat: 43.11, lon: -89.39, num_docks_available: 20 });

    const change = findStationChange(
      current,
      snapshot([current.pickup, unavailableDropoff, sameAsPickup, distinct, tooFar]),
      undefined,
      NOW,
    );

    expect(change).toMatchObject({
      kind: 'dropoff',
      previous: current.dropoff,
      replacement: distinct,
      reason: 'unavailable',
    });
    expect(change?.alternatives.map((candidate) => candidate.station_id)).toEqual(['distinct']);
  });

  it('applies only current, relevant, non-null station decisions', () => {
    const current = fullJourney();
    const replacement = station('replacement');
    const change = {
      kind: 'pickup' as const,
      previous: current.pickup,
      replacement,
      alternatives: [replacement],
      reason: 'no-bikes' as const,
    };
    const applied = applyStationChange(current, change, NOW + 1);

    expect(applied).toMatchObject({ pickup: replacement, updatedAt: NOW + 1 });
    expect(applyStationChange({ ...current, stage: 'ride' }, change, NOW + 2)).toEqual({
      ...current,
      stage: 'ride',
    });
    expect(applyStationChange(applied, change, NOW + 2)).toBe(applied);
    expect(applyStationChange(current, { ...change, replacement: null }, NOW + 2)).toBe(current);
  });
});
