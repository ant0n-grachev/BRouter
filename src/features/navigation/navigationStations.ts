import type { Station, StationSnapshot } from '../../types';

export interface NavigationStations {
  stations: Station[];
  missingStationIds: string[];
}

export function getNavigationStations(
  selected: Station[],
  snapshot: StationSnapshot | null,
  alternatives: Station[] = [],
): NavigationStations {
  const requested = new Map<string, Station>();
  for (const station of [...selected, ...alternatives]) {
    if (!requested.has(station.station_id)) requested.set(station.station_id, station);
  }

  const current = new Map(
    (snapshot?.stations ?? []).map((station) => [station.station_id, station] as const),
  );
  const stations = [...requested].map(([stationId, stored]) => current.get(stationId) ?? stored);
  const missingStationIds = [...requested.keys()].filter((stationId) => !current.has(stationId));

  return { stations, missingStationIds };
}
