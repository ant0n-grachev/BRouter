import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Station } from '../types';
import StationMapLeaflet from './StationMapLeaflet';

interface MockMarkerProps {
  children: React.ReactNode;
  icon: {
    iconSize: [number, number];
    iconAnchor: [number, number];
    html: string;
  };
}

const { mapContainerSpy, mapContainerZoomControlSpy, zoomControlSpy, markerSpy } = vi.hoisted(
  () => ({
    mapContainerSpy: vi.fn(),
    mapContainerZoomControlSpy: vi.fn(),
    zoomControlSpy: vi.fn(),
    markerSpy: vi.fn<(props: MockMarkerProps) => void>(),
  }),
);

vi.mock('leaflet', () => ({
  divIcon: (options: unknown) => options,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    bounds,
    zoomControl,
  }: {
    children: React.ReactNode;
    bounds: unknown;
    zoomControl?: boolean;
  }) => {
    mapContainerSpy(bounds);
    mapContainerZoomControlSpy(zoomControl);
    return <div>{children}</div>;
  },
  ZoomControl: (props: { position: string }) => {
    zoomControlSpy(props);
    return null;
  },
  Marker: (props: MockMarkerProps) => {
    markerSpy(props);
    return <div>{props.children}</div>;
  },
  Polygon: () => null,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ fitBounds: vi.fn() }),
}));

function station(overrides: Partial<Station> = {}): Station {
  return {
    station_id: 'station',
    name: 'Station',
    lat: 43.07,
    lon: -89.4,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 3,
    num_docks_available: 4,
    ...overrides,
  };
}

describe('StationMapLeaflet station popup actions', () => {
  beforeEach(() => {
    mapContainerSpy.mockClear();
    mapContainerZoomControlSpy.mockClear();
    zoomControlSpy.mockClear();
    markerSpy.mockClear();
  });

  it('expands compact count markers without shifting their coordinate or shrinking circle targets', () => {
    render(
      <StationMapLeaflet
        stations={[
          station({ station_id: 'short' }),
          station({ station_id: 'double', num_bikes_available: 12, num_docks_available: 20 }),
          station({ station_id: 'triple', num_bikes_available: 123, num_docks_available: 99 }),
          station({ station_id: 'closed', is_installed: false }),
        ]}
        coverage={[]}
        origin={{ lat: 43.07, lon: -89.4 }}
        destination={{ lat: 43.08, lon: -89.38 }}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={[]}
        dropoffCandidateIds={[]}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    const icons = markerSpy.mock.calls.map(([props]) => props.icon);
    expect(icons.map((icon) => icon.iconSize)).toEqual([
      [38, 26],
      [42, 26],
      [48, 26],
      [26, 26],
      [26, 26],
      [26, 26],
    ]);
    for (const icon of icons) {
      expect(icon.iconAnchor).toEqual(icon.iconSize.map((size: number) => size / 2));
    }
    expect(icons[1].html).toContain('12/20');
    expect(icons[2].html).toContain('123/99');
    expect(icons[3].html).toContain('×');
  });

  it('places the explicit zoom control below and to the right of station popups', () => {
    render(
      <StationMapLeaflet
        stations={[]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={[]}
        dropoffCandidateIds={[]}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    expect(mapContainerSpy).toHaveBeenCalled();
    expect(mapContainerZoomControlSpy).toHaveBeenCalledWith(false);
    expect(zoomControlSpy).toHaveBeenCalledWith({ position: 'bottomright' });
  });

  it('lets a station candidate be chosen as pickup and drop-off', async () => {
    const user = userEvent.setup();
    const onSelectPickup = vi.fn();
    const onSelectDropoff = vi.fn();

    render(
      <StationMapLeaflet
        stations={[station({ station_id: 'eligible', name: 'Eligible Station' })]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={['eligible']}
        dropoffCandidateIds={['eligible']}
        onSelectPickup={onSelectPickup}
        onSelectDropoff={onSelectDropoff}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choose Eligible Station as pickup' }));
    await user.click(screen.getByRole('button', { name: 'Choose Eligible Station as drop-off' }));

    expect(onSelectPickup).toHaveBeenCalledWith('eligible');
    expect(onSelectDropoff).toHaveBeenCalledWith('eligible');
  });

  it('does not offer actions for stations absent from either candidate list', () => {
    render(
      <StationMapLeaflet
        stations={[
          station({ station_id: 'eligible', name: 'Eligible Station' }),
          station({
            station_id: 'disabled',
            name: 'Disabled Station',
            is_installed: false,
            is_renting: true,
            is_returning: true,
          }),
        ]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={['eligible']}
        dropoffCandidateIds={[]}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Choose Eligible Station as pickup' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Eligible Station as drop-off/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disabled Station/ })).not.toBeInTheDocument();
  });

  it('does not offer the redundant action for a station already selected in that role', () => {
    render(
      <StationMapLeaflet
        stations={[station({ station_id: 'selected', name: 'Selected Station' })]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId="selected"
        selectedDropoffId={null}
        pickupCandidateIds={['selected']}
        dropoffCandidateIds={['selected']}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Choose Selected Station as pickup' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose Selected Station as drop-off' }),
    ).toBeVisible();
  });

  it('frames a planned trip around its candidate stations instead of every regional station', () => {
    render(
      <StationMapLeaflet
        stations={[
          station({ station_id: 'pickup', name: 'Pickup Candidate', lat: 43.07, lon: -89.4 }),
          station({ station_id: 'dropoff', name: 'Drop-off Candidate', lat: 43.08, lon: -89.38 }),
          station({ station_id: 'far-away', name: 'Far Regional Station', lat: 43.5, lon: -89 }),
        ]}
        coverage={[]}
        origin={{ lat: 43.069, lon: -89.401 }}
        destination={{ lat: 43.081, lon: -89.379 }}
        selectedPickupId="pickup"
        selectedDropoffId="dropoff"
        pickupCandidateIds={['pickup']}
        dropoffCandidateIds={['dropoff']}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    expect(mapContainerSpy).toHaveBeenLastCalledWith([
      [43.07, -89.4],
      [43.08, -89.38],
      [43.069, -89.401],
      [43.081, -89.379],
    ]);
    expect(screen.getByText('Pickup Candidate')).toBeVisible();
    expect(screen.getByText('Drop-off Candidate')).toBeVisible();
    expect(screen.queryByText('Far Regional Station')).not.toBeInTheDocument();
  });

  it('keeps every station visible in the service-area overview before candidates exist', () => {
    render(
      <StationMapLeaflet
        stations={[
          station({ station_id: 'nearby', name: 'Nearby Station' }),
          station({ station_id: 'regional', name: 'Regional Station', lat: 43.5, lon: -89 }),
        ]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={[]}
        dropoffCandidateIds={[]}
        onSelectPickup={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    expect(screen.getByText('Nearby Station')).toBeVisible();
    expect(screen.getByText('Regional Station')).toBeVisible();
  });
});
