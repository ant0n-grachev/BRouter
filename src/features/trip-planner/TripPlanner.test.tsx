import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { Station } from '../../types';
import TripPlanner from './TripPlanner';
import { useTripPlanner } from './useTripPlanner';

const stations: Station[] = [
  {
    station_id: 'pickup',
    name: 'Capitol Square',
    lat: 43.0735,
    lon: -89.401,
    is_installed: true,
    is_renting: true,
    is_returning: false,
    num_bikes_available: 4,
    num_docks_available: 0,
  },
  {
    station_id: 'dropoff',
    name: 'Library Mall',
    lat: 43.0755,
    lon: -89.398,
    is_installed: true,
    is_renting: false,
    is_returning: true,
    num_bikes_available: 0,
    num_docks_available: 5,
  },
];

const stationsWithAlternativePickup: Station[] = [
  ...stations,
  {
    station_id: 'pickup-alternative',
    name: 'West Washington & Bedford',
    lat: 43.074,
    lon: -89.3997,
    is_installed: true,
    is_renting: true,
    is_returning: false,
    num_bikes_available: 2,
    num_docks_available: 0,
  },
];

function Harness({
  onStartNavigation,
  onStartPickupNavigation,
}: Pick<ComponentProps<typeof TripPlanner>, 'onStartNavigation' | 'onStartPickupNavigation'> = {}) {
  const controller = useTripPlanner(stations);
  return (
    <>
      <TripPlanner
        controller={controller}
        onStartNavigation={onStartNavigation}
        onStartPickupNavigation={onStartPickupNavigation}
      />
      <output aria-label="Origin source">{controller.originMode}</output>
    </>
  );
}

function EmptyHarness() {
  const controller = useTripPlanner([]);
  return <TripPlanner controller={controller} />;
}

function AlternativePickupHarness({
  onStartPickupNavigation,
}: Pick<ComponentProps<typeof TripPlanner>, 'onStartPickupNavigation'> = {}) {
  const controller = useTripPlanner(stationsWithAlternativePickup);
  return <TripPlanner controller={controller} onStartPickupNavigation={onStartPickupNavigation} />;
}

function RefreshingHarness({ currentStations }: { currentStations: Station[] }) {
  const controller = useTripPlanner(currentStations);
  return <TripPlanner controller={controller} />;
}

describe('TripPlanner', () => {
  let geolocationDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    geolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  });
  afterEach(() => {
    if (geolocationDescriptor)
      Object.defineProperty(navigator, 'geolocation', geolocationDescriptor);
    else Reflect.deleteProperty(navigator, 'geolocation');
  });
  it('clears both fields, station selections and a resolved trip', async () => {
    const user = userEvent.setup();
    render(<Harness onStartNavigation={vi.fn()} />);
    await user.type(
      screen.getByRole('combobox', { name: 'Starting location' }),
      '43.07310, -89.40120{Enter}',
    );
    await user.type(
      screen.getByRole('combobox', { name: 'Destination' }),
      '43.07520, -89.39820{Enter}',
    );
    expect(await screen.findByRole('button', { name: 'Go to navigation' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('');
    expect(screen.queryByRole('group', { name: 'Pickup station' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Drop-off station' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to navigation' })).not.toBeInTheDocument();
  });

  it('uses the device button and switches to manual as soon as the starting field is edited', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    let success!: PositionCallback;
    const getCurrentPosition = vi.fn((next: PositionCallback) => {
      success = next;
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(<Harness onStartPickupNavigation={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    act(() =>
      success({ coords: { latitude: 43.0731, longitude: -89.4012 } } as GeolocationPosition),
    );

    expect(screen.getByRole('status', { name: 'Origin source' })).toHaveTextContent('device');
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue('My location');
    expect(screen.getByRole('button', { name: 'Navigate to pickup' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Starting location' }), {
      target: { value: 'New address' },
    });
    expect(screen.getByRole('status', { name: 'Origin source' })).toHaveTextContent('manual');
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue('New address');
    expect(screen.queryByRole('button', { name: 'Navigate to pickup' })).not.toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });

  it('ignores a device location response after Clear or manual typing', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    const callbacks: PositionCallback[] = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => callbacks.push(success),
      },
    });
    render(<Harness onStartPickupNavigation={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    act(() =>
      callbacks[0]?.({ coords: { latitude: 43.0731, longitude: -89.4012 } } as GeolocationPosition),
    );
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue('');
    expect(screen.getByRole('status', { name: 'Origin source' })).toHaveTextContent('manual');
    expect(screen.queryByRole('group', { name: 'Pickup station' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Starting location' }), {
      target: { value: 'Entered address' },
    });
    act(() =>
      callbacks[1]?.({ coords: { latitude: 43.0731, longitude: -89.4012 } } as GeolocationPosition),
    );
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue(
      'Entered address',
    );
    expect(screen.getByRole('status', { name: 'Origin source' })).toHaveTextContent('manual');
    expect(screen.queryByRole('group', { name: 'Pickup station' })).not.toBeInTheDocument();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });

  it('resolves coordinate searches and offers full-trip navigation', async () => {
    const user = userEvent.setup();
    render(<Harness onStartNavigation={vi.fn()} />);

    await user.type(
      screen.getByRole('combobox', { name: 'Starting location' }),
      '43.07310, -89.40120{Enter}',
    );
    await user.type(
      screen.getByRole('combobox', { name: 'Destination' }),
      '43.07520, -89.39820{Enter}',
    );

    expect(await screen.findByRole('group', { name: 'Pickup station' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Drop-off station' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Go to navigation' })).toBeVisible();
    expect(document.querySelector('a[href*="google.com/maps"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Navigate to pickup' })).not.toBeInTheDocument();
  });

  it('automatically resolves a manual origin on field exit without a search button', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(
      screen.queryByRole('button', { name: /Search (starting location|destination)/ }),
    ).not.toBeInTheDocument();
    const origin = screen.getByRole('combobox', { name: 'Starting location' });
    await user.type(origin, '43.07310, -89.40120');
    await user.click(screen.getByRole('combobox', { name: 'Destination' }));

    expect(await screen.findByRole('group', { name: 'Pickup station' })).toBeVisible();
  });

  it('starts in-app navigation to the selected pickup without requiring a destination', async () => {
    const user = userEvent.setup();
    const onStartPickupNavigation = vi.fn();
    render(<Harness onStartPickupNavigation={onStartPickupNavigation} />);

    await user.type(
      screen.getByRole('combobox', { name: 'Starting location' }),
      '43.07310, -89.40120{Enter}',
    );

    const navigate = await screen.findByRole('button', { name: 'Navigate to pickup' });
    expect(screen.getByRole('region', { name: 'Navigate to your pickup' })).toContainElement(
      navigate,
    );
    await user.click(navigate);
    expect(onStartPickupNavigation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lat: 43.0731, lon: -89.4012 }),
      stations[0],
    );
    expect(document.querySelector('a[href*="google.com/maps"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to navigation' })).not.toBeInTheDocument();
  });

  it('uses the current pickup selection for pickup-only navigation', async () => {
    const user = userEvent.setup();
    const onStartPickupNavigation = vi.fn();
    render(<AlternativePickupHarness onStartPickupNavigation={onStartPickupNavigation} />);

    await user.type(
      screen.getByRole('combobox', { name: 'Starting location' }),
      '43.07310, -89.40120{Enter}',
    );
    await user.click(await screen.findByRole('radio', { name: /West Washington & Bedford/ }));

    await user.click(screen.getByRole('button', { name: 'Navigate to pickup' }));
    expect(onStartPickupNavigation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lat: 43.0731, lon: -89.4012 }),
      stationsWithAlternativePickup[2],
    );
  });

  it('keeps manual entry available after a device-location error and provides retry', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    expect(
      await screen.findByText('Couldn’t find your location. Enter an address or try again.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await user.clear(screen.getByRole('combobox', { name: 'Starting location' }));
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toBeVisible();

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });

  it('switches to manual origin entry when device location is outside station coverage', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    const position: GeolocationPosition = {
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 44,
        longitude: -89,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    };
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position));
    const geolocation: Geolocation = {
      getCurrentPosition,
      watchPosition: () => 1,
      clearWatch: () => undefined,
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue(''),
    );
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toBeVisible();
    expect(
      screen.getByText(
        'Your device location is outside the current BCycle service area. Enter a starting location instead.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry device location' })).not.toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });

  it('switches to manual origin entry when the service area is not available yet', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    const position: GeolocationPosition = {
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 43.0731,
        longitude: -89.4012,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success(position),
        watchPosition: () => 1,
        clearWatch: () => undefined,
      } satisfies Geolocation,
    });

    render(<EmptyHarness />);
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue(''),
    );
    expect(
      screen.getByText(
        'Live station data is not available to validate your device location. Enter a starting location instead.',
      ),
    ).toBeVisible();

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });

  it('switches to manual origin when refreshed station coverage excludes the device location', async () => {
    const user = userEvent.setup();
    const originalGeolocation = navigator.geolocation;
    const position: GeolocationPosition = {
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 43.0731,
        longitude: -89.4012,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success(position),
        watchPosition: () => 1,
        clearWatch: () => undefined,
      } satisfies Geolocation,
    });
    const { rerender } = render(<RefreshingHarness currentStations={stations} />);

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue(
        'My location',
      ),
    );

    const distantStations = stations.map((currentStation, index) => ({
      ...currentStation,
      lat: 44 + index * 0.001,
      lon: -89,
    }));
    rerender(<RefreshingHarness currentStations={distantStations} />);

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue(''),
    );
    expect(
      screen.getByText(
        'Your device location is outside the current BCycle service area. Enter a starting location instead.',
      ),
    ).toBeVisible();

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
  });
});
