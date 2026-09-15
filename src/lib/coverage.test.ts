import type { Station } from '../types';
import {
  computeStationCoverageHull,
  computeStationServiceArea,
  isPointWithinStationServiceArea,
} from './coverage';

function station(id: string, lat: number, lon: number, installed = true): Station {
  return {
    station_id: id,
    name: id,
    lat,
    lon,
    is_installed: installed,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 1,
    num_docks_available: 1,
  };
}

describe('computeStationCoverageHull', () => {
  it('returns a deterministic outer hull without interior or unusable station points', () => {
    const stations = [
      station('north-west', 2, 0),
      station('center', 1, 1),
      station('south-east', 0, 2),
      station('south-west', 0, 0),
      station('north-east', 2, 2),
      station('uninstalled', 3, 1, false),
      station('invalid', 91, 1),
    ];

    expect(computeStationCoverageHull(stations)).toEqual([
      { lat: 0, lon: 0 },
      { lat: 2, lon: 0 },
      { lat: 2, lon: 2 },
      { lat: 0, lon: 2 },
    ]);
  });

  it('keeps the available valid points when fewer than three exist', () => {
    expect(
      computeStationCoverageHull([station('east', 43.07, -89.3), station('west', 43.08, -89.5)]),
    ).toEqual([
      { lat: 43.08, lon: -89.5 },
      { lat: 43.07, lon: -89.3 },
    ]);
  });
});

describe('computeStationServiceArea', () => {
  it('uses exact station coordinates in the service-area cache identity', () => {
    const firstArea = computeStationServiceArea([station('station', 43.000001, -89.4)]);
    const movedArea = computeStationServiceArea([station('station', 43.000002, -89.4)]);

    expect(firstArea?.cacheKey).not.toBe(movedArea?.cacheKey);
  });

  it('includes installed stations even when bikes and docks are temporarily unavailable', () => {
    const emptyStation = {
      ...station('empty', 43.0731, -89.4012),
      is_renting: false,
      is_returning: false,
      num_bikes_available: 0,
      num_docks_available: 0,
    };

    const area = computeStationServiceArea([
      emptyStation,
      station('uninstalled', 43.08, -89.4, false),
      station('invalid', Number.NaN, -89.4),
    ]);

    expect(area?.points).toEqual([{ lat: emptyStation.lat, lon: emptyStation.lon }]);
    expect(area?.bounds.west).toBeLessThan(emptyStation.lon);
    expect(area?.bounds.east).toBeGreaterThan(emptyStation.lon);
    expect(area?.bounds.south).toBeLessThan(emptyStation.lat);
    expect(area?.bounds.north).toBeGreaterThan(emptyStation.lat);
  });

  it('includes the one-mile boundary and excludes points beyond it', () => {
    const area = computeStationServiceArea([station('origin', 0, 0)]);
    expect(area).not.toBeNull();
    if (!area) return;

    const oneMileLatitude = ((1 / 0.621371 / 6371.0088) * 180) / Math.PI;
    expect(isPointWithinStationServiceArea(area, { lat: oneMileLatitude, lon: 0 })).toBe(true);
    expect(isPointWithinStationServiceArea(area, { lat: oneMileLatitude * 1.001, lon: 0 })).toBe(
      false,
    );
  });
});
