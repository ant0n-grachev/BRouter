import { useEffect, useMemo } from 'react';
import { divIcon } from 'leaflet';
import type { DivIcon, LatLngBoundsExpression, LatLngTuple } from 'leaflet';
import {
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { StationMapProps } from './StationMap';
import { getStationMapState } from './stationMapState';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MARKER_HEIGHT = 26;

function markerIcon(symbol: string, state: string, selected: boolean): DivIcon {
  const selectedClass = selected ? ' station-map__marker--selected' : '';
  const disabled = state === 'disabled';
  const width = disabled ? MARKER_HEIGHT : Math.max(38, symbol.length * 6 + 12);
  return divIcon({
    className: 'station-map__marker-container',
    html: `<span class="station-map__marker station-map__marker--${state}${selectedClass}" aria-hidden="true">${symbol}</span>`,
    iconAnchor: [width / 2, MARKER_HEIGHT / 2],
    iconSize: [width, MARKER_HEIGHT],
  });
}

function pointIcon(symbol: 'O' | 'X', state: 'origin' | 'destination'): DivIcon {
  return divIcon({
    className: 'station-map__marker-container',
    html: `<span class="station-map__marker station-map__marker--${state}" aria-hidden="true">${symbol}</span>`,
    iconAnchor: [MARKER_HEIGHT / 2, MARKER_HEIGHT / 2],
    iconSize: [MARKER_HEIGHT, MARKER_HEIGHT],
  });
}

function BoundsUpdater({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [28, 28] });
  }, [bounds, map]);
  return null;
}

export default function StationMapLeaflet({
  stations,
  coverage,
  origin,
  destination,
  selectedPickupId,
  selectedDropoffId,
  pickupCandidateIds,
  dropoffCandidateIds,
  onSelectPickup,
  onSelectDropoff,
}: StationMapProps) {
  const focusStationIds = useMemo(() => {
    const ids = new Set([...pickupCandidateIds, ...dropoffCandidateIds]);
    if (selectedPickupId) ids.add(selectedPickupId);
    if (selectedDropoffId) ids.add(selectedDropoffId);
    return ids;
  }, [dropoffCandidateIds, pickupCandidateIds, selectedDropoffId, selectedPickupId]);
  const visibleStations = useMemo(
    () =>
      focusStationIds.size > 0
        ? stations.filter((station) => focusStationIds.has(station.station_id))
        : stations,
    [focusStationIds, stations],
  );
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const points: LatLngTuple[] = visibleStations
      .filter(
        (station) =>
          Number.isFinite(station.lat) &&
          Number.isFinite(station.lon) &&
          station.lat >= -90 &&
          station.lat <= 90 &&
          station.lon >= -180 &&
          station.lon <= 180,
      )
      .map((station) => [station.lat, station.lon]);
    if (origin) points.push([origin.lat, origin.lon]);
    if (destination) points.push([destination.lat, destination.lon]);
    return points.length > 0
      ? points
      : ([
          [43, -90],
          [44, -89],
        ] as LatLngTuple[]);
  }, [destination, origin, visibleStations]);

  return (
    <MapContainer
      className="station-map__leaflet"
      bounds={bounds}
      scrollWheelZoom={false}
      keyboard
      zoomControl={false}
    >
      <BoundsUpdater bounds={bounds} />
      <ZoomControl position="bottomright" />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={OSM_ATTRIBUTION}
      />
      {coverage.length >= 3 ? (
        <Polygon
          positions={coverage.map((point) => [point.lat, point.lon] as LatLngTuple)}
          pathOptions={{ color: '#075985', fillColor: '#7dd3fc', fillOpacity: 0.12, weight: 2 }}
        />
      ) : null}
      {visibleStations.map((station) => {
        const mapState = getStationMapState(station);
        const accessibleDescription = `${station.name}: ${station.num_bikes_available} bikes, ${station.num_docks_available} docks. ${mapState.label}.`;
        const selected =
          station.station_id === selectedPickupId || station.station_id === selectedDropoffId;
        const canSelectPickup =
          station.station_id !== selectedPickupId &&
          pickupCandidateIds.includes(station.station_id);
        const canSelectDropoff =
          station.station_id !== selectedDropoffId &&
          dropoffCandidateIds.includes(station.station_id);
        return (
          <Marker
            key={station.station_id}
            position={[station.lat, station.lon]}
            icon={markerIcon(mapState.symbol, mapState.state, selected)}
            zIndexOffset={selected ? 0 : canSelectPickup || canSelectDropoff ? 1000 : -500}
            keyboard
            title={accessibleDescription}
            alt={accessibleDescription}
          >
            <Popup>
              <div className="station-map__popup">
                <strong>{station.name}</strong>
                <span>{mapState.label}</span>
                <span>
                  {station.num_bikes_available} bikes · {station.num_docks_available} docks
                </span>
                {station.station_id === selectedPickupId ? (
                  <span className="station-map__popup-selected">Selected pickup</span>
                ) : null}
                {station.station_id === selectedDropoffId ? (
                  <span className="station-map__popup-selected">Selected drop-off</span>
                ) : null}
                {canSelectPickup || canSelectDropoff ? (
                  <div className="station-map__popup-actions">
                    {canSelectPickup ? (
                      <button
                        className="station-map__popup-action station-map__popup-action--pickup"
                        type="button"
                        aria-label={`Choose ${station.name} as pickup`}
                        onClick={() => onSelectPickup(station.station_id)}
                      >
                        Choose as pickup
                      </button>
                    ) : null}
                    {canSelectDropoff ? (
                      <button
                        className="station-map__popup-action station-map__popup-action--dropoff"
                        type="button"
                        aria-label={`Choose ${station.name} as drop-off`}
                        onClick={() => onSelectDropoff(station.station_id)}
                      >
                        Choose as drop-off
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Popup>
          </Marker>
        );
      })}
      {origin ? (
        <Marker
          position={[origin.lat, origin.lon]}
          icon={pointIcon('O', 'origin')}
          interactive={false}
          keyboard={false}
          zIndexOffset={-1000}
          title="Trip origin"
          alt="Trip origin"
        />
      ) : null}
      {destination ? (
        <Marker
          position={[destination.lat, destination.lon]}
          icon={pointIcon('X', 'destination')}
          interactive={false}
          keyboard={false}
          zIndexOffset={-1000}
          title="Trip destination"
          alt="Trip destination"
        />
      ) : null}
    </MapContainer>
  );
}
