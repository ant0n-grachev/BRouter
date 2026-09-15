import type { Station } from '../types';
import { getStationMapState } from './stationMapState';

function station(overrides: Partial<Station>): Station {
  return {
    station_id: 'station',
    name: 'Station',
    lat: 43.07,
    lon: -89.4,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 3,
    num_docks_available: 4,
    ...overrides,
  };
}

describe('getStationMapState', () => {
  it.each([
    ['pickup and drop-off', station({}), 'pickup-dropoff', '3/4'],
    ['pickup only', station({ is_returning: false }), 'pickup', '3/4'],
    ['drop-off only', station({ is_renting: false }), 'dropoff', '3/4'],
    ['no bikes', station({ num_bikes_available: 0 }), 'empty', '0/4'],
    ['no docks', station({ num_docks_available: 0 }), 'full', '3/0'],
    [
      'no bikes or docks',
      station({ num_bikes_available: 0, num_docks_available: 0 }),
      'unavailable',
      '0/0',
    ],
  ] as const)(
    'shows exact bikes/docks counts for open station state: %s',
    (_case, value, state, symbol) => {
      expect(getStationMapState(value)).toMatchObject({ state, symbol });
    },
  );

  it.each([
    [
      'not installed',
      station({
        is_installed: false,
        num_bikes_available: 7,
        num_docks_available: 9,
      }),
    ],
    [
      'closed for rentals and returns',
      station({
        is_renting: false,
        is_returning: false,
        num_bikes_available: 7,
        num_docks_available: 9,
      }),
    ],
  ] as const)(
    'shows a cross instead of reported inventory when a station is %s',
    (_case, value) => {
      expect(getStationMapState(value)).toMatchObject({ state: 'disabled', symbol: '×' });
    },
  );
});
