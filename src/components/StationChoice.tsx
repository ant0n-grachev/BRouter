import { useId } from 'react';
import type { RankedStation, StationRankKind } from '../lib/stations';

interface StationChoiceProps {
  kind: StationRankKind;
  candidates: readonly RankedStation[];
  selectedId: string;
  onSelect: (stationId: string) => void;
}

function availabilityCount(candidate: RankedStation, kind: StationRankKind): number {
  return kind === 'pickup'
    ? candidate.station.num_bikes_available
    : candidate.station.num_docks_available;
}

function availabilityText(candidate: RankedStation, kind: StationRankKind): string {
  const count = availabilityCount(candidate, kind);
  const noun = kind === 'pickup' ? 'bike' : 'dock';
  if (count === 1) return `1 ${noun} left`;
  return `${count} ${noun}s available`;
}

function rankingLabel(candidate: RankedStation, kind: StationRankKind): string {
  if (candidate.reason === 'closest') return 'Closest';
  if (candidate.reason === 'more-availability') {
    return kind === 'pickup' ? 'More bikes' : 'More docks';
  }
  return 'Nearby';
}

export default function StationChoice({
  kind,
  candidates,
  selectedId,
  onSelect,
}: StationChoiceProps) {
  const generatedId = useId();
  const title = kind === 'pickup' ? 'Pickup station' : 'Drop-off station';

  return (
    <fieldset className="station-choice">
      <legend>{title}</legend>
      <div className="station-choice__list">
        {candidates.map((candidate) => {
          const inputId = `${generatedId}-${candidate.station.station_id}`;
          const hasLowAvailability = availabilityCount(candidate, kind) === 1;
          return (
            <label
              className={
                candidate.station.station_id === selectedId
                  ? 'station-choice__item station-choice__item--selected'
                  : 'station-choice__item'
              }
              htmlFor={inputId}
              key={candidate.station.station_id}
            >
              <input
                id={inputId}
                type="radio"
                name={`${generatedId}-${kind}`}
                checked={candidate.station.station_id === selectedId}
                onChange={() => onSelect(candidate.station.station_id)}
              />
              <span className="station-choice__body">
                <span className="station-choice__heading">
                  <span className="station-choice__name">{candidate.station.name}</span>
                  <span className="station-choice__badge">{rankingLabel(candidate, kind)}</span>
                </span>
                <span
                  className={
                    hasLowAvailability
                      ? 'station-choice__meta station-choice__warning'
                      : 'station-choice__meta'
                  }
                >
                  {candidate.distanceMi.toFixed(2)} mi · {availabilityText(candidate, kind)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
