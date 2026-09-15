import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Station } from '../types';
import StationChoice from './StationChoice';

function station(id: string, bikes: number, docks: number): Station {
  return {
    station_id: id,
    name: id === 'recommended' ? 'Capitol Square' : 'Very Long Alternative Station Name',
    lat: 43.07,
    lon: -89.4,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: bikes,
    num_docks_available: docks,
  };
}

describe('StationChoice', () => {
  it('labels the recommendation and alternatives with concise distance and availability', () => {
    render(
      <StationChoice
        kind="pickup"
        candidates={[
          { station: station('recommended', 5, 3), distanceMi: 0.21, reason: 'closest' },
          {
            station: station('alternative', 3, 5),
            distanceMi: 0.34,
            reason: 'next-closest',
          },
        ]}
        selectedId="recommended"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Pickup station' })).toBeVisible();
    expect(screen.getByText('Closest')).toBeVisible();
    expect(screen.getByText('Nearby')).toBeVisible();
    const recommendation = screen.getByRole('radio', { name: /Capitol Square/i }).closest('label');
    expect(recommendation).toHaveTextContent('0.21 mi · 5 bikes available');
    expect(recommendation).not.toHaveTextContent('straight-line estimate');
  });

  it('keeps two decimal distance labels even when displayed distances match', () => {
    render(
      <StationChoice
        kind="pickup"
        candidates={[
          { station: station('recommended', 5, 3), distanceMi: 0.086, reason: 'closest' },
          { station: station('alternative', 3, 5), distanceMi: 0.094, reason: 'next-closest' },
        ]}
        selectedId="recommended"
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('radio', { name: /Capitol Square/i }).closest('label'),
    ).toHaveTextContent('0.09 mi');
    expect(
      screen.getByRole('radio', { name: /Very Long Alternative Station Name/i }).closest('label'),
    ).toHaveTextContent('0.09 mi');
  });

  it.each([
    ['pickup', 5, 3, 7, 3, 'More bikes'],
    ['dropoff', 3, 5, 3, 7, 'More docks'],
  ] as const)(
    'explains a higher-availability %s alternative',
    (kind, recommendedBikes, recommendedDocks, alternativeBikes, alternativeDocks, label) => {
      render(
        <StationChoice
          kind={kind}
          candidates={[
            {
              station: station('recommended', recommendedBikes, recommendedDocks),
              distanceMi: 0.1,
              reason: 'closest',
            },
            {
              station: station('alternative', alternativeBikes, alternativeDocks),
              distanceMi: 0.18,
              reason: 'more-availability',
            },
          ]}
          selectedId="recommended"
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByText('Closest')).toBeVisible();
      expect(screen.getByText(label)).toBeVisible();
    },
  );

  it('explains a lower-availability pickup alternative as the next closest station', () => {
    render(
      <StationChoice
        kind="pickup"
        candidates={[
          { station: station('recommended', 5, 3), distanceMi: 0.1, reason: 'closest' },
          {
            station: station('alternative', 3, 3),
            distanceMi: 0.36,
            reason: 'next-closest',
          },
        ]}
        selectedId="recommended"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Closest')).toBeVisible();
    expect(screen.getByText('Nearby')).toBeVisible();
  });

  it('selects an alternative station', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <StationChoice
        kind="dropoff"
        candidates={[
          { station: station('recommended', 2, 5), distanceMi: 0.2, reason: 'closest' },
          {
            station: station('alternative', 4, 3),
            distanceMi: 0.3,
            reason: 'next-closest',
          },
        ]}
        selectedId="recommended"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /Very Long Alternative Station Name/i }));

    expect(onSelect).toHaveBeenCalledWith('alternative');
  });

  it.each([
    ['pickup', 1, 4, '0.10 mi · 1 bike left'],
    ['dropoff', 4, 1, '0.10 mi · 1 dock left'],
  ] as const)(
    'shows low %s availability once in the warning metadata',
    (kind, bikes, docks, warning) => {
      render(
        <StationChoice
          kind={kind}
          candidates={[
            { station: station('recommended', bikes, docks), distanceMi: 0.1, reason: 'closest' },
          ]}
          selectedId="recommended"
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByText(warning)).toHaveClass(
        'station-choice__meta',
        'station-choice__warning',
      );
      expect(screen.queryByText(/Only 1 (bike|dock) available\./)).not.toBeInTheDocument();
    },
  );
});
