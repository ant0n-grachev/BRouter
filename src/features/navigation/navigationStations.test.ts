import type { Station, StationSnapshot } from '../../types';
import { getNavigationStations } from './navigationStations';

function station(id: string, name: string, bikes = 2): Station {
  return {
    station_id: id,
    name,
    lat: 43.07,
    lon: -89.4,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: bikes,
    num_docks_available: 4,
  };
}

function snapshot(stations: Station[]): StationSnapshot {
  return {
    stations,
    fetchedAt: 1_000,
    feedUpdatedAt: 900,
    ttlSeconds: 60,
    isStale: false,
  };
}

describe('getNavigationStations', () => {
  it('keeps selected route stations pinned while preferring current snapshot records', () => {
    const storedPickup = station('pickup', 'Stored pickup', 1);
    const storedDropoff = station('dropoff', 'Stored drop-off', 1);
    const livePickup = { ...storedPickup, name: 'Live pickup', num_bikes_available: 7 };
    const unrelated = station('unrelated', 'Unrelated station');

    const result = getNavigationStations(
      [storedPickup, storedDropoff],
      snapshot([livePickup, unrelated]),
      [storedPickup, station('alternative', 'Alternative')],
    );

    expect(result.stations).toEqual([
      livePickup,
      storedDropoff,
      station('alternative', 'Alternative'),
    ]);
    expect(result.missingStationIds).toEqual(['dropoff', 'alternative']);
  });

  it('deduplicates by station id without adding unrelated snapshot stations', () => {
    const selected = station('selected', 'Selected');
    const duplicate = { ...selected, name: 'Duplicate input' };
    const liveSelected = { ...selected, name: 'Current selected' };

    const result = getNavigationStations(
      [selected, duplicate],
      snapshot([station('unrelated', 'Unrelated'), liveSelected]),
      [duplicate],
    );

    expect(result).toEqual({ stations: [liveSelected], missingStationIds: [] });
  });

  it('retains every requested station and marks all ids missing without a snapshot', () => {
    const pickup = station('pickup', 'Stored pickup');
    const alternative = station('alternative', 'Stored alternative');

    expect(getNavigationStations([pickup], null, [alternative])).toEqual({
      stations: [pickup, alternative],
      missingStationIds: ['pickup', 'alternative'],
    });
  });
});
