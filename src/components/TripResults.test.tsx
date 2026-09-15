import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTripPlan } from '../lib/tripPlanner';
import type { Station } from '../types';
import TripResults from './TripResults';

function station(id: string, name: string, lat: number, lon: number): Station {
  return {
    station_id: id,
    name,
    lat,
    lon,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 4,
    num_docks_available: 5,
  };
}

describe('TripResults', () => {
  it('starts in-app navigation with the currently selected trip only after the rider presses Go', async () => {
    const origin = { lat: 43.0731, lon: -89.4012 };
    const destination = { lat: 43.081, lon: -89.39, label: 'Destination address' };
    const dropoff = station('dropoff', 'Library Mall', 43.08, -89.391);
    const originalPlan = createTripPlan(
      origin,
      destination,
      station('pickup', 'Capitol Square', 43.074, -89.4),
      dropoff,
    );
    const selectedPlan = createTripPlan(
      origin,
      destination,
      station('alternative', 'State Street', 43.075, -89.399),
      dropoff,
    );
    const onStartNavigation = vi.fn();
    const { rerender } = render(
      <TripResults plan={originalPlan} onStartNavigation={onStartNavigation} />,
    );
    expect(onStartNavigation).not.toHaveBeenCalled();

    rerender(<TripResults plan={selectedPlan} onStartNavigation={onStartNavigation} />);
    await userEvent.click(screen.getByRole('button', { name: 'Go to navigation' }));

    expect(onStartNavigation).toHaveBeenCalledExactlyOnceWith(selectedPlan);
  });
});
