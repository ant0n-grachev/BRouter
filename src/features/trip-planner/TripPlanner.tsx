import LocationSearch from '../../components/LocationSearch';
import StationChoice from '../../components/StationChoice';
import TripResults from '../../components/TripResults';
import type { TripPlan } from '../../lib/tripPlanner';
import type { LatLon, Station } from '../../types';
import type { useTripPlanner } from './useTripPlanner';

export interface TripPlannerProps {
  controller: ReturnType<typeof useTripPlanner>;
  onStartNavigation?: (plan: TripPlan) => void;
  onStartPickupNavigation?: (origin: LatLon, pickup: Station) => void;
}

export default function TripPlanner({
  controller,
  onStartNavigation,
  onStartPickupNavigation,
}: TripPlannerProps) {
  const {
    originMode,
    useCurrentLocation,
    clear,
    originText,
    setOriginText,
    destinationText,
    setDestinationText,
    originSearchKey,
    destinationSearchKey,
    originModeNotice,
    serviceArea,
    setManualOrigin,
    setDestination,
    origin,
    deviceLocation,
    pickupCandidates,
    dropoffCandidates,
    selectedPickup,
    selectedDropoff,
    selectPickup,
    selectDropoff,
    pickupIssue,
    dropoffIssue,
    plan,
  } = controller;
  return (
    <section className="trip-planner" aria-label="Trip planner">
      <div className="trip-planner__locations">
        <LocationSearch
          key={`origin-${originSearchKey}`}
          label="Starting location"
          value={originText}
          onValueChange={setOriginText}
          onInputChange={() => setManualOrigin(null)}
          onSelectionChange={(selection) => setManualOrigin(selection)}
          searchAfterPause
          serviceArea={serviceArea}
          inputAction={
            <button
              className="button button--secondary location-search__device"
              type="button"
              aria-label="Use my location"
              aria-busy={originMode === 'device' && deviceLocation.loading}
              onClick={useCurrentLocation}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
              </svg>
            </button>
          }
        />

        {originModeNotice ? (
          <p className="planner-message" role="status">
            {originModeNotice}
          </p>
        ) : null}

        {originMode === 'device' ? (
          <div className="device-location" aria-live="polite" aria-atomic="true">
            {deviceLocation.loading ? (
              <p className="visually-hidden" role="status">
                Finding your location.
              </p>
            ) : null}
            {deviceLocation.error ? (
              <div className="device-location__error">
                <p className="field-error" role="alert">
                  Couldn’t find your location. Enter an address or try again.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <LocationSearch
          key={`destination-${destinationSearchKey}`}
          label="Destination"
          value={destinationText}
          onValueChange={setDestinationText}
          onSelectionChange={(selection) => setDestination(selection)}
          searchAfterPause
          serviceArea={serviceArea}
        />
      </div>
      <button className="trip-planner__clear" type="button" onClick={clear}>
        Clear
      </button>

      {pickupIssue ? (
        <p className="planner-message" role="status">
          {pickupIssue}
        </p>
      ) : null}
      {selectedPickup ? (
        <StationChoice
          kind="pickup"
          candidates={pickupCandidates}
          selectedId={selectedPickup.station.station_id}
          onSelect={selectPickup}
        />
      ) : null}
      {origin !== null && selectedPickup !== null && plan === null && onStartPickupNavigation ? (
        <section
          className="pickup-shortcut"
          aria-label="Navigate to your pickup"
          aria-live="polite"
          aria-atomic="true"
        >
          <button
            className="button button--primary"
            type="button"
            onClick={() => onStartPickupNavigation(origin, selectedPickup.station)}
          >
            Navigate to pickup
          </button>
        </section>
      ) : null}

      {dropoffIssue ? (
        <p className="planner-message" role="status">
          {dropoffIssue}
        </p>
      ) : null}
      {selectedDropoff ? (
        <StationChoice
          kind="dropoff"
          candidates={dropoffCandidates}
          selectedId={selectedDropoff.station.station_id}
          onSelect={selectDropoff}
        />
      ) : null}

      {plan ? <TripResults plan={plan} onStartNavigation={onStartNavigation} /> : null}
    </section>
  );
}
