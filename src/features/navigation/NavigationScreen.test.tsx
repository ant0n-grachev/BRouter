import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import type { Station, StationSnapshot } from '../../types';
import { createTripPlan } from '../../lib/tripPlanner';
import { createJourney, createPickupJourney, type Journey, type RerouteMode } from './journey';
import NavigationScreen from './NavigationScreen';

// The browser suite exercises Leaflet. These tests exercise the real journey controls.
vi.mock('./NavigationMap', () => ({ default: () => null }));

vi.mock('./routingClient', () => ({
  fetchRoute: ({
    from,
    to,
  }: {
    from: { lat: number; lon: number };
    to: { lat: number; lon: number };
  }) =>
    Promise.resolve({
      geometry: [from, to],
      distanceMeters: 500,
      durationSeconds: 240,
      instructions: [
        {
          text: 'Continue along the path.',
          geometryIndex: 0,
          distanceMeters: 500,
          durationSeconds: 240,
        },
      ],
    }),
}));

const pickup: Station = {
  station_id: 'p',
  name: 'Capitol Square',
  lat: 43.0732,
  lon: -89.4011,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  num_bikes_available: 3,
  num_docks_available: 4,
};
const dropoff: Station = {
  ...pickup,
  station_id: 'd',
  name: 'Library Mall',
  lat: 43.08,
  lon: -89.41,
};
const alternative: Station = {
  ...pickup,
  station_id: 'p2',
  name: 'Bedford',
  lat: 43.074,
  lon: -89.401,
};
const destination = { lat: 43.083, lon: -89.412, label: 'Memorial Union' };
let reportLocation: PositionCallback;
const watchPosition = vi.fn((success: PositionCallback) => {
  reportLocation = success;
  return 1;
});

function snapshot(stations: Station[]): StationSnapshot {
  return {
    stations,
    fetchedAt: Date.now(),
    feedUpdatedAt: Date.now(),
    ttlSeconds: 300,
    isStale: false,
  };
}

function Harness({
  data,
  mode = 'ask',
  onExit = vi.fn(),
  pickupOnly = false,
  locationMode = 'device',
}: {
  data: StationSnapshot;
  mode?: RerouteMode;
  onExit?: () => void;
  pickupOnly?: boolean;
  locationMode?: Journey['locationMode'];
}) {
  const [journey, setJourney] = useState(() =>
    pickupOnly
      ? createPickupJourney({ lat: 43.07, lon: -89.401 }, pickup, mode, Date.now(), locationMode)
      : createJourney(
          createTripPlan({ lat: 43.07, lon: -89.401 }, destination, pickup, dropoff),
          mode,
          Date.now(),
          locationMode,
        ),
  );
  const updateJourney = useCallback(
    (transition: (current: Journey) => Journey) => setJourney(transition),
    [],
  );
  return (
    <NavigationScreen
      journey={journey}
      updateJourney={updateJourney}
      onExit={onExit}
      snapshot={data}
      stationError={null}
      online
    />
  );
}

beforeEach(() => {
  watchPosition.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition,
      clearWatch: vi.fn(),
    },
  });
});

function locate(station: Station) {
  act(() =>
    reportLocation({
      coords: {
        latitude: station.lat,
        longitude: station.lon,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition),
  );
}

describe('guided navigation screen', () => {
  it.each([false, true])(
    'keeps manual-origin navigation a route overview (pickup only: %s)',
    async (pickupOnly) => {
      render(
        <Harness
          pickupOnly={pickupOnly}
          locationMode="manual"
          data={snapshot([pickup, dropoff, alternative])}
        />,
      );

      await waitFor(() =>
        expect(document.querySelector('.navigation-time')).toHaveTextContent('4 min'),
      );
      expect(watchPosition).not.toHaveBeenCalled();
      expect(screen.getByRole('region', { name: 'Route overview' })).toHaveTextContent(
        'Walk to pickup',
      );
      expect(screen.queryByText('Continue along the path.')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open BCycle app' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Finish trip' })).not.toBeInTheDocument();

      if (!pickupOnly) {
        await userEvent.click(screen.getByRole('button', { name: 'Ride to drop-off' }));
        expect(screen.getByRole('region', { name: 'Route overview' })).toHaveTextContent(
          'Ride to drop-off',
        );
        expect(watchPosition).not.toHaveBeenCalled();
      }
    },
  );

  it('ends a pickup-only trip at the selected bike station', async () => {
    const onExit = vi.fn();
    render(<Harness pickupOnly onExit={onExit} data={snapshot([pickup, alternative])} />);
    locate(pickup);
    await userEvent.click(await screen.findByRole('button', { name: 'Finish trip' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('keeps giving directions when near the station but still a short walk away', async () => {
    render(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    locate({ ...pickup, lat: pickup.lat + 0.0005 });
    expect(await screen.findByRole('link', { name: 'Open BCycle app' })).toBeVisible();
    expect(await screen.findByText('Continue along the path.')).toBeVisible();
    expect(screen.queryByText('You’ve arrived')).not.toBeInTheDocument();
  });
  it('lets the rider jump directly to any leg and back without a location fix', async () => {
    render(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Walk to destination' }));
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Memorial Union');
    await userEvent.click(screen.getByRole('button', { name: 'Ride to drop-off' }));
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Library Mall');
    await userEvent.click(screen.getByRole('button', { name: 'Walk to pickup' }));
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Capitol Square');
    expect(screen.getByRole('button', { name: 'Walk to pickup' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps the chosen leg after opening BCycle and returning to BRouter', async () => {
    render(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    locate(pickup);
    const link = await screen.findByRole('link', { name: 'Open BCycle app' });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(link);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByRole('heading', { name: 'Walk to pickup' })).toBeInTheDocument();
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Capitol Square');
  });

  it('shows the BCycle handoff only near the station and never opens an unlock URL', async () => {
    render(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    expect(screen.getByRole('heading', { name: 'Walk to pickup' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open BCycle app' })).not.toBeInTheDocument();
    locate(pickup);
    expect(await screen.findByRole('link', { name: 'Open BCycle app' })).toHaveAttribute(
      'href',
      'bcycle://',
    );
    expect(screen.getByText('You’re near Capitol Square.')).toBeVisible();
  });

  it('asks before changing an unavailable pickup, then guides to the accepted replacement', async () => {
    const { rerender } = render(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    rerender(
      <Harness data={snapshot([{ ...pickup, num_bikes_available: 0 }, dropoff, alternative])} />,
    );
    expect(screen.getByRole('heading', { name: 'Walk to pickup' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use Bedford' })).toBeVisible();
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Capitol Square');
    await userEvent.click(screen.getByRole('button', { name: 'Use Bedford' }));
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Bedford');
  });

  it('automatically changes an unavailable station when that setting is selected', async () => {
    render(
      <Harness
        mode="automatic"
        data={snapshot([{ ...pickup, num_bikes_available: 0 }, dropoff, alternative])}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('navigation-target')).toHaveTextContent('Bedford'),
    );
    expect(screen.queryByRole('button', { name: 'Use Bedford' })).not.toBeInTheDocument();
  });

  it('keeps the chosen station and explains when no alternative exists', () => {
    render(
      <Harness
        mode="automatic"
        data={snapshot([
          { ...pickup, num_bikes_available: 0 },
          { ...dropoff, num_bikes_available: 0 },
        ])}
      />,
    );
    expect(screen.getByText(/No alternative pickup station/)).toBeVisible();
    expect(screen.getByTestId('navigation-target')).toHaveTextContent('Capitol Square');
  });

  it('requires a decision before handing off at an unavailable selected station', async () => {
    render(
      <Harness data={snapshot([{ ...pickup, num_bikes_available: 0 }, dropoff, alternative])} />,
    );
    locate(pickup);
    expect(screen.queryByRole('link', { name: 'Open BCycle app' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep current station' }));
    expect(await screen.findByRole('link', { name: 'Open BCycle app' })).toHaveAttribute(
      'href',
      'bcycle://',
    );
  });

  it('asks again if a kept station recovers and then becomes unavailable again', async () => {
    const unavailable = () =>
      snapshot([{ ...pickup, num_bikes_available: 0 }, dropoff, alternative]);
    const { rerender } = render(<Harness data={unavailable()} />);
    locate(pickup);
    await userEvent.click(screen.getByRole('button', { name: 'Keep current station' }));
    expect(screen.getByRole('link', { name: 'Open BCycle app' })).toBeVisible();

    rerender(<Harness data={snapshot([pickup, dropoff, alternative])} />);
    rerender(<Harness data={unavailable()} />);

    expect(screen.getByRole('button', { name: 'Use Bedford' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open BCycle app' })).not.toBeInTheDocument();
  });

  it('does not forget a kept station decision when availability temporarily becomes stale', async () => {
    const unavailable = () =>
      snapshot([{ ...pickup, num_bikes_available: 0 }, dropoff, alternative]);
    const { rerender } = render(<Harness data={unavailable()} />);
    locate(pickup);
    await userEvent.click(screen.getByRole('button', { name: 'Keep current station' }));

    rerender(<Harness data={{ ...snapshot([pickup, dropoff, alternative]), isStale: true }} />);
    rerender(<Harness data={unavailable()} />);

    expect(screen.getByRole('button', { name: 'Review alternatives' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open BCycle app' })).toBeVisible();
  });
});
