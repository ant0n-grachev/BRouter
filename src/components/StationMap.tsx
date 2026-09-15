import { lazy, Suspense } from 'react';
import type { LatLon, Station } from '../types';

const LazyStationMapLeaflet = lazy(() => import('./StationMapLeaflet'));

export interface StationMapProps {
  stations: readonly Station[];
  coverage: readonly LatLon[];
  origin: LatLon | null;
  destination: LatLon | null;
  selectedPickupId: string | null;
  selectedDropoffId: string | null;
  pickupCandidateIds: readonly string[];
  dropoffCandidateIds: readonly string[];
  onSelectPickup: (stationId: string) => void;
  onSelectDropoff: (stationId: string) => void;
}

const legendItems = [
  ['2/2', 'pickup-dropoff', '2 bikes and 2 docks available'],
  ['2/0', 'full', '2 bikes available and no docks available'],
  ['0/2', 'empty', 'No bikes available and 2 docks available'],
  ['0/0', 'unavailable', 'No bikes or docks available'],
] as const;

export default function StationMap(props: StationMapProps) {
  const showingTripChoices =
    props.pickupCandidateIds.length > 0 || props.dropoffCandidateIds.length > 0;

  return (
    <div className="station-map" role="region" aria-label="Interactive Madison BCycle station map">
      <div className="station-map__legend" aria-label="Station map legend">
        <span className="station-map__legend-title">Bikes / docks</span>
        {legendItems.map(([symbol, state, label]) => (
          <span className="station-map__legend-item" key={`${state}-${symbol}`}>
            <span
              className={`station-map__legend-symbol station-map__legend-symbol--${state}`}
              aria-hidden="true"
            >
              {symbol}
            </span>
            <span className="visually-hidden">{label}</span>
          </span>
        ))}
      </div>
      <p className="visually-hidden">
        {showingTripChoices
          ? 'Showing your pickup and drop-off choices. Tap a candidate marker to view details and choose pickup or drop-off. Selected stations have a bold outline. '
          : 'Selected pickup and drop-off stations have a bold outline. '}
        Use the map controls or arrow keys to move the map.
      </p>
      <div className="station-map__canvas">
        <Suspense fallback={<div className="station-map__loading">Loading station map…</div>}>
          <LazyStationMapLeaflet {...props} />
        </Suspense>
      </div>
    </div>
  );
}
