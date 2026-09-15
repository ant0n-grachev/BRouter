import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { StationSnapshot, SystemAvailability } from '../types';
import ServiceStatus from './ServiceStatus';

const snapshot: StationSnapshot = {
  stations: [],
  fetchedAt: Date.UTC(2026, 7, 30, 17, 30),
  feedUpdatedAt: Date.UTC(2026, 7, 30, 17, 29),
  ttlSeconds: 60,
  isStale: false,
};

function renderStatus(
  availability: SystemAvailability,
  overrides: Partial<React.ComponentProps<typeof ServiceStatus>> = {},
) {
  const onRefresh = vi.fn();
  const onToggleMap = vi.fn();
  const user = userEvent.setup();
  render(
    <ServiceStatus
      snapshot={snapshot}
      availability={availability}
      error={null}
      refreshing={false}
      mapAvailable
      mapExpanded={false}
      onRefresh={onRefresh}
      onToggleMap={onToggleMap}
      {...overrides}
    />,
  );
  return { onRefresh, onToggleMap, user };
}

describe('ServiceStatus', () => {
  it('does not render a visible status summary for normal operational availability', () => {
    renderStatus('operational');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh|retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/last successful refresh/i)).not.toBeInTheDocument();
  });

  it.each([
    ['no-bikes', 'No bikes available right now.'],
    ['no-docks', 'No docks available right now.'],
    ['service-disabled', 'Bike service is unavailable right now.'],
  ] satisfies readonly (readonly [SystemAvailability, string])[])(
    'renders a visible status summary for %s availability',
    (availability, message) => {
      renderStatus(availability);

      expect(screen.getByRole('status')).toHaveTextContent(message);
    },
  );

  it('does not describe zero bikes as a seasonal closure', () => {
    renderStatus('no-bikes');

    expect(screen.queryByText(/season|closed/i)).not.toBeInTheDocument();
  });

  it('keeps cached stale data and failed background updates silent', () => {
    renderStatus('stale', {
      snapshot: { ...snapshot, isStale: true },
      error: 'Unable to refresh station data.',
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show station map' })).toBeEnabled();
  });

  it('offers one retry when the initial station load fails', async () => {
    const { onRefresh, user } = renderStatus('unavailable', {
      snapshot: null,
      error: 'Unable to load station data.',
      mapAvailable: false,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t load stations.');
    const retry = screen.getByRole('button', { name: 'Retry' });
    await user.click(retry);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows concise map-toggle text while retaining descriptive accessible labels', async () => {
    const user = userEvent.setup();

    function ToggleHarness() {
      const [mapExpanded, setMapExpanded] = useState(false);

      return (
        <ServiceStatus
          snapshot={snapshot}
          availability="operational"
          error={null}
          refreshing={false}
          mapAvailable
          mapExpanded={mapExpanded}
          onRefresh={vi.fn()}
          onToggleMap={() => setMapExpanded((expanded) => !expanded)}
        />
      );
    }

    render(<ToggleHarness />);

    const showButton = screen.getByRole('button', { name: 'Show station map' });
    expect(showButton).toHaveTextContent(/^Show$/);

    await user.click(showButton);

    expect(screen.getByRole('button', { name: 'Hide station map' })).toHaveTextContent(/^Hide$/);
  });

  it('does not announce routine background refreshing', () => {
    renderStatus('unavailable', { snapshot: null, refreshing: true });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/refreshing/i)).not.toBeInTheDocument();
  });
});
