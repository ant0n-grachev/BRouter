import { createTripPlan } from '../../lib/tripPlanner';
import type { Station } from '../../types';
import { createJourney, createPickupJourney, type LocationMode } from './journey';
import { readJourney, readRerouteMode, writeJourney, writeRerouteMode } from './journeyStorage';

const JOURNEY_KEY = 'brouter:journey:v1';
const REROUTE_KEY = 'brouter:reroute-mode:v1';
const NOW = 1_800_000_000_000;

function station(id: string, lat: number, lon: number): Station {
  return {
    station_id: id,
    name: id,
    lat,
    lon,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 4,
    num_docks_available: 5,
  };
}

function storedJourney(locationMode: LocationMode = 'manual') {
  const trip = createTripPlan(
    { lat: 43.0731, lon: -89.4012 },
    { lat: 43.081, lon: -89.39, label: 'Destination' },
    station('pickup', 43.074, -89.4),
    station('dropoff', 43.08, -89.391),
  );
  return { ...createJourney(trip, 'automatic', NOW, locationMode), id: 'stored-journey' };
}

function storedPickupJourney() {
  return {
    ...createPickupJourney(
      { lat: 43.0731, lon: -89.4012 },
      station('pickup', 43.074, -89.4),
      'ask',
      NOW,
    ),
    id: 'stored-pickup-journey',
  };
}

describe('journey storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['full', storedJourney],
    ['pickup-only', storedPickupJourney],
  ])('round-trips a valid %s journey', (_label, createStoredJourney) => {
    const current = createStoredJourney();
    writeJourney(current);
    expect(readJourney(NOW)).toEqual(current);
  });

  it('round-trips a device-origin journey', () => {
    const current = storedJourney('device');

    writeJourney(current);

    expect(readJourney(NOW)).toEqual(current);
  });

  it('removes a journey when navigation ends', () => {
    writeJourney(storedJourney());
    writeJourney(null);

    expect(localStorage.getItem(JOURNEY_KEY)).toBeNull();
    expect(readJourney(NOW)).toBeNull();
  });

  it('expires a journey more than twelve hours after its last update', () => {
    writeJourney(storedJourney());

    expect(readJourney(NOW + 12 * 60 * 60 * 1_000)).not.toBeNull();
    expect(readJourney(NOW + 12 * 60 * 60 * 1_000 + 1)).toBeNull();
  });

  it.each([
    'not-json',
    JSON.stringify({ version: 2 }),
    JSON.stringify({ ...storedJourney(), origin: { lat: 91, lon: -89.4 } }),
    JSON.stringify({ ...storedJourney(), pickup: { ...storedJourney().pickup, station_id: '' } }),
    JSON.stringify({ ...storedPickupJourney(), stage: 'ride' }),
    JSON.stringify({ ...storedJourney(), destination: null, stage: 'destination' }),
    JSON.stringify({ ...storedJourney(), locationMode: 'tracking' }),
  ])('rejects corrupt or internally inconsistent persisted journeys', (value) => {
    localStorage.setItem(JOURNEY_KEY, value);
    expect(readJourney(NOW)).toBeNull();
  });

  it('loads legacy version-one journeys as manual while stripping obsolete handoff data', () => {
    const legacy: Record<string, unknown> = {
      ...storedJourney(),
      handoff: { stage: 'pickup', departed: true },
    };
    delete legacy.locationMode;
    localStorage.setItem(JOURNEY_KEY, JSON.stringify(legacy));

    const restored = readJourney(NOW);
    expect(restored).toEqual(storedJourney());
    expect(restored).not.toHaveProperty('handoff');
  });

  it('defaults absent optional endpoints to null for pickup-only version-one data', () => {
    const legacyPickup = storedPickupJourney();
    const withoutOptionalEndpoints: Record<string, unknown> = { ...legacyPickup };
    delete withoutOptionalEndpoints.destination;
    delete withoutOptionalEndpoints.dropoff;
    localStorage.setItem(JOURNEY_KEY, JSON.stringify(withoutOptionalEndpoints));

    expect(readJourney(NOW)).toEqual(legacyPickup);
  });

  it('persists only the journey contract and never stores GPS or legacy handoff state', () => {
    const current = {
      ...storedJourney(),
      currentPosition: { lat: 43.075, lon: -89.399 },
      handoff: { stage: 'pickup', departed: true },
    };

    writeJourney(current);

    const persisted: unknown = JSON.parse(localStorage.getItem(JOURNEY_KEY) ?? '{}');
    expect(persisted).not.toHaveProperty('currentPosition');
    expect(persisted).not.toHaveProperty('handoff');
    expect(readJourney(NOW)).toEqual(storedJourney());
  });

  it('stores the reroute preference separately and defaults invalid values to ask', () => {
    expect(readRerouteMode()).toBe('ask');
    writeRerouteMode('automatic');
    expect(localStorage.getItem(REROUTE_KEY)).toBe('automatic');
    expect(readRerouteMode()).toBe('automatic');

    localStorage.setItem(REROUTE_KEY, 'always');
    expect(readRerouteMode()).toBe('ask');
  });

  it('tolerates storage read and write failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    expect(readJourney(NOW)).toBeNull();
    expect(readRerouteMode()).toBe('ask');

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    expect(() => writeJourney(storedJourney())).not.toThrow();
    expect(() => writeRerouteMode('automatic')).not.toThrow();
  });
});
