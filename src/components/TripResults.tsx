import type { TripPlan } from '../lib/tripPlanner';

export default function TripResults({
  plan,
  onStartNavigation,
}: {
  plan: TripPlan;
  onStartNavigation?: (plan: TripPlan) => void;
}) {
  if (!onStartNavigation) return null;

  return (
    <div className="trip-results">
      <button
        className="button button--primary trip-results__start"
        type="button"
        onClick={() => onStartNavigation(plan)}
      >
        Go to navigation
      </button>
    </div>
  );
}
