import type { StationSnapshot, SystemAvailability } from '../types';

interface ServiceStatusProps {
  snapshot: StationSnapshot | null;
  availability: SystemAvailability;
  error: string | null;
  refreshing: boolean;
  mapAvailable: boolean;
  mapExpanded: boolean;
  onRefresh: () => void;
  onToggleMap: () => void;
}

function availabilityMessage(availability: SystemAvailability): string | null {
  switch (availability) {
    case 'operational':
    case 'stale':
    case 'unavailable':
      return null;
    case 'no-bikes':
      return 'No bikes available right now.';
    case 'no-docks':
      return 'No docks available right now.';
    case 'service-disabled':
      return 'Bike service is unavailable right now.';
  }
}

export default function ServiceStatus({
  snapshot,
  availability,
  error,
  refreshing,
  mapAvailable,
  mapExpanded,
  onRefresh,
  onToggleMap,
}: ServiceStatusProps) {
  const loadFailed = Boolean(error && !snapshot);
  const message = loadFailed ? 'Couldn’t load stations.' : availabilityMessage(availability);
  return (
    <section className="service-status" aria-labelledby="service-status-title">
      <div className="service-status__header">
        <div>
          <h2 id="service-status-title">Service Area Map</h2>
        </div>
        <div className="service-status__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onToggleMap}
            disabled={!mapAvailable}
            aria-label={mapExpanded ? 'Hide station map' : 'Show station map'}
            aria-expanded={mapExpanded}
          >
            {mapExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`service-status__summary service-status__summary--${loadFailed ? 'unavailable' : availability}`}
          role="status"
          aria-live="polite"
        >
          <span>{message}</span>
          {loadFailed ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
