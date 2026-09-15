import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NavigationMap from './NavigationMap';
import type { RoutedPath } from './routingTypes';

const camera = vi.hoisted(() => ({ bearing: 0, drag: () => {}, rotate: () => {} }));
const map = vi.hoisted(() => ({
  getBearing: () => camera.bearing,
  setBearing: vi.fn((value: number) => {
    camera.bearing = ((value % 360) + 360) % 360;
    camera.rotate();
  }),
  setHeading: vi.fn((heading: number) => {
    camera.bearing = ((-heading % 360) + 360) % 360;
    camera.rotate();
  }),
  stopHeadingUp: vi.fn(),
  fitBounds: vi.fn(),
  getSize: () => ({ y: 800 }),
  getBoundsZoom: () => 17,
  getZoom: () => 15,
  setView: vi.fn(),
  invalidateSize: vi.fn(),
}));
vi.mock('@tomickigrzegorz/leaflet-rotate', () => ({}));
vi.mock('react-leaflet', () => {
  const Children = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    MapContainer: Children,
    Circle: () => null,
    CircleMarker: Children,
    Polyline: () => null,
    Popup: () => null,
    TileLayer: () => null,
    Tooltip: () => null,
    ZoomControl: () => null,
    Marker: ({ icon }: { icon: { options: { html: string } } }) => (
      <div data-testid="location-marker" dangerouslySetInnerHTML={{ __html: icon.options.html }} />
    ),
    useMap: () => map,
    useMapEvents: (events: { dragstart: () => void; rotate?: () => void }) => {
      camera.drag = events.dragstart;
      camera.rotate = events.rotate ?? (() => {});
      return map;
    },
  };
});

const route = {
  geometry: [
    { lat: 43, lon: -89 },
    { lat: 43.1, lon: -89.1 },
  ],
} as RoutedPath;
const props = {
  route,
  fix: { lat: 43, lon: -89, accuracy: 8, timestamp: 1, heading: 35 },
  heading: 90,
  locationEnabled: true,
  active: true,
  onFollow: vi.fn(),
  target: { lat: 43.1, lon: -89.1 },
  stations: [],
  missingStationIds: [],
  targetStationId: null,
};
function settleRotation() {
  act(() => {
    vi.advanceTimersByTime(1500);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  camera.bearing = 0;
  map.setBearing.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NavigationMap bearing lifecycle', () => {
  it('rotates the map in follow mode, pauses after drag, and resets Show route north-up', () => {
    const { rerender } = render(<NavigationMap {...props} />);
    expect(camera.bearing).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Follow my location' }));
    settleRotation();
    expect(camera.bearing).toBe(270);
    expect(document.querySelector('[data-heading]')).toHaveAttribute('data-heading', '90');
    expect(document.querySelector('[data-heading]')).toHaveAttribute('data-screen-heading', '0');
    act(() => camera.drag());
    rerender(<NavigationMap {...props} heading={180} />);
    settleRotation();
    expect(camera.bearing).toBe(270);
    fireEvent.click(screen.getByRole('button', { name: 'Show route' }));
    expect(camera.bearing).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Follow my location' }));
    settleRotation();
    expect(camera.bearing).toBe(180);
  });

  it('uses GPS bearing when compass is unavailable and masks stale manual-view location', () => {
    const { rerender } = render(<NavigationMap {...props} heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow my location' }));
    settleRotation();
    expect(camera.bearing).toBe(325);
    rerender(<NavigationMap {...props} locationEnabled={false} />);
    expect(camera.bearing).toBe(0);
    expect(screen.queryByRole('button', { name: 'Follow my location' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('location-marker')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show route' })).not.toBeDisabled();
  });

  it('does not reframe a manually panned route when a pending route response arrives', () => {
    const { rerender } = render(<NavigationMap {...props} locationEnabled={false} />);
    act(() => camera.drag());
    map.fitBounds.mockClear();
    rerender(<NavigationMap {...props} locationEnabled={false} route={{ ...route }} />);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Show route' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
