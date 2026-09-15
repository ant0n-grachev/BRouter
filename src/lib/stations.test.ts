import type { Station } from '../types';
import { rankStations } from './stations';

function station(overrides: Partial<Station>): Station {
  return {
    station_id: 'station',
    name: 'Station',
    lat: 43.0001,
    lon: -89,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 3,
    num_docks_available: 4,
    ...overrides,
  };
}

describe('rankStations', () => {
  it('enforces pickup eligibility and ignores invalid coordinates', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'valid' }),
        station({ station_id: 'uninstalled', is_installed: false }),
        station({ station_id: 'not-renting', is_renting: false }),
        station({ station_id: 'empty', num_bikes_available: 0 }),
        station({ station_id: 'invalid-latitude', lat: 91 }),
        station({ station_id: 'invalid-longitude', lon: -181 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual(['valid']);
  });

  it('enforces drop-off eligibility', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'valid' }),
        station({ station_id: 'not-returning', is_returning: false }),
        station({ station_id: 'full', num_docks_available: 0 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'dropoff' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual(['valid']);
  });

  it('recommends the closest pickup, the true next closest, then one highest-bike alternative', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'pickup-closest', lat: 43.0001, num_bikes_available: 2 }),
        station({ station_id: 'pickup-next-closest', lat: 43.001, num_bikes_available: 1 }),
        station({ station_id: 'pickup-second-most-bikes', lat: 43.002, num_bikes_available: 7 }),
        station({ station_id: 'pickup-most-bikes', lat: 43.006, num_bikes_available: 9 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(
      ranked.map((candidate) => ({
        id: candidate.station.station_id,
        reason: candidate.reason,
      })),
    ).toEqual([
      { id: 'pickup-closest', reason: 'closest' },
      { id: 'pickup-next-closest', reason: 'next-closest' },
      { id: 'pickup-most-bikes', reason: 'more-availability' },
    ]);
  });

  it('recommends the closest drop-off, the true next closest, then one highest-dock alternative', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'dropoff-closest', lat: 43.0001, num_docks_available: 4 }),
        station({ station_id: 'dropoff-next-closest', lat: 43.001, num_docks_available: 3 }),
        station({ station_id: 'dropoff-second-most-docks', lat: 43.002, num_docks_available: 12 }),
        station({ station_id: 'dropoff-most-docks', lat: 43.006, num_docks_available: 20 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'dropoff' },
    );

    expect(
      ranked.map((candidate) => ({
        id: candidate.station.station_id,
        reason: candidate.reason,
      })),
    ).toEqual([
      { id: 'dropoff-closest', reason: 'closest' },
      { id: 'dropoff-next-closest', reason: 'next-closest' },
      { id: 'dropoff-most-docks', reason: 'more-availability' },
    ]);
  });

  it('keeps a highest-availability next-closest pickup in the distance slot and finds a distinct availability alternative', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'pickup-closest', lat: 43.0001, num_bikes_available: 2 }),
        station({
          station_id: 'pickup-next-closest-highest',
          lat: 43.001,
          num_bikes_available: 10,
        }),
        station({
          station_id: 'pickup-remaining-most-bikes',
          lat: 43.002,
          num_bikes_available: 7,
        }),
        station({
          station_id: 'pickup-remaining-lower-bikes',
          lat: 43.003,
          num_bikes_available: 5,
        }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(
      ranked.map((candidate) => ({
        id: candidate.station.station_id,
        reason: candidate.reason,
      })),
    ).toEqual([
      { id: 'pickup-closest', reason: 'closest' },
      { id: 'pickup-next-closest-highest', reason: 'next-closest' },
      { id: 'pickup-remaining-most-bikes', reason: 'more-availability' },
    ]);
  });

  it.each([
    {
      kind: 'pickup' as const,
      countFields: {
        closest: { num_bikes_available: 9 },
        second: { num_bikes_available: 4 },
        third: { num_bikes_available: 2 },
      },
      expected: [
        { id: 'pickup-closest', reason: 'closest' },
        { id: 'pickup-second', reason: 'next-closest' },
        { id: 'pickup-third', reason: 'next-closest' },
      ],
    },
    {
      kind: 'dropoff' as const,
      countFields: {
        closest: { num_docks_available: 20 },
        second: { num_docks_available: 12 },
        third: { num_docks_available: 3 },
      },
      expected: [
        { id: 'dropoff-closest', reason: 'closest' },
        { id: 'dropoff-second', reason: 'next-closest' },
        { id: 'dropoff-third', reason: 'next-closest' },
      ],
    },
  ])(
    'uses nearest unused $kind stations when none has more relevant availability than the closest',
    ({ kind, countFields, expected }) => {
      const ranked = rankStations(
        [
          station({ station_id: `${kind}-closest`, lat: 43.0001, ...countFields.closest }),
          station({ station_id: `${kind}-second`, lat: 43.001, ...countFields.second }),
          station({ station_id: `${kind}-third`, lat: 43.002, ...countFields.third }),
        ],
        { lat: 43, lon: -89 },
        { kind },
      );

      expect(
        ranked.map((candidate) => ({
          id: candidate.station.station_id,
          reason: candidate.reason,
        })),
      ).toEqual(expected);
    },
  );

  it('uses distance then station ID as deterministic tie breakers', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'b', lat: 43.001, num_bikes_available: 4 }),
        station({ station_id: 'a', lat: 43.001, num_bikes_available: 4 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual(['a', 'b']);
  });

  it.each([
    {
      kind: 'pickup' as const,
      near: { station_id: 'near-low', lat: 43.001, num_bikes_available: 1 },
      tied: { station_id: 'tied-high', lat: 43.00100001, num_bikes_available: 8 },
    },
    {
      kind: 'dropoff' as const,
      near: { station_id: 'near-low', lat: 43.001, num_docks_available: 1 },
      tied: { station_id: 'tied-high', lat: 43.00100001, num_docks_available: 8 },
    },
  ])(
    'uses relevant availability before station ID for effectively exact $kind distance ties',
    ({ kind, near, tied }) => {
      const ranked = rankStations(
        [station({ ...near }), station({ ...tied })],
        { lat: 43, lon: -89 },
        { kind },
      );

      expect(ranked.map((candidate) => candidate.station.station_id)).toEqual([
        'tied-high',
        'near-low',
      ]);
    },
  );

  it('keeps a measurably closer pickup first even when the farther station has more bikes', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'closer-low', lat: 43.001, num_bikes_available: 1 }),
        station({ station_id: 'farther-high', lat: 43.00101, num_bikes_available: 8 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual([
      'closer-low',
      'farther-high',
    ]);
  });

  it('keeps actual distance authoritative outside the effective tie tolerance', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'near-low', lat: 43.001, num_bikes_available: 1 }),
        station({ station_id: 'far-high', lat: 43.0011, num_bikes_available: 8 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual([
      'near-low',
      'far-high',
    ]);
  });

  it('filters stations beyond the one-mile maximum and returns no more than three', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'one', lat: 43.001 }),
        station({ station_id: 'two', lat: 43.002 }),
        station({ station_id: 'three', lat: 43.003 }),
        station({ station_id: 'four', lat: 43.004 }),
        station({ station_id: 'too-far', lat: 43.02 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'pickup' },
    );

    expect(ranked).toHaveLength(3);
    expect(ranked.some((candidate) => candidate.station.station_id === 'too-far')).toBe(false);
  });

  it('excludes the pickup from drop-off choices when an alternative exists', () => {
    const ranked = rankStations(
      [
        station({ station_id: 'pickup', num_docks_available: 8 }),
        station({ station_id: 'alternative', lat: 43.0002, num_docks_available: 2 }),
      ],
      { lat: 43, lon: -89 },
      { kind: 'dropoff', excludeStationId: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual(['alternative']);
  });

  it('allows the same station only when no other valid drop-off is available', () => {
    const ranked = rankStations(
      [station({ station_id: 'pickup' })],
      { lat: 43, lon: -89 },
      { kind: 'dropoff', excludeStationId: 'pickup' },
    );

    expect(ranked.map((candidate) => candidate.station.station_id)).toEqual(['pickup']);
  });
});
