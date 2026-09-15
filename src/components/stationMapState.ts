import type { Station } from '../types';

export type StationMapStateName =
  'pickup' | 'dropoff' | 'pickup-dropoff' | 'empty' | 'full' | 'unavailable' | 'disabled';

export interface StationMapState {
  state: StationMapStateName;
  symbol: string;
  label: string;
}

export function getStationMapState(station: Station): StationMapState {
  const symbol = `${station.num_bikes_available}/${station.num_docks_available}`;

  if (!station.is_installed || (!station.is_renting && !station.is_returning)) {
    return { state: 'disabled', symbol: '×', label: 'Disabled station' };
  }
  if (station.num_bikes_available === 0 && station.num_docks_available === 0) {
    return { state: 'unavailable', symbol, label: 'No bikes or docks available' };
  }
  if (station.is_renting && station.num_bikes_available === 0) {
    return { state: 'empty', symbol, label: 'No bikes available' };
  }
  if (station.is_returning && station.num_docks_available === 0) {
    return { state: 'full', symbol, label: 'No docks available' };
  }

  const pickup = station.is_renting && station.num_bikes_available > 0;
  const dropoff = station.is_returning && station.num_docks_available > 0;
  if (pickup && dropoff) {
    return { state: 'pickup-dropoff', symbol, label: 'Pickup and drop-off available' };
  }
  if (pickup) return { state: 'pickup', symbol, label: 'Pickup available' };
  if (dropoff) return { state: 'dropoff', symbol, label: 'Drop-off available' };
  return { state: 'disabled', symbol: '×', label: 'Disabled station' };
}
