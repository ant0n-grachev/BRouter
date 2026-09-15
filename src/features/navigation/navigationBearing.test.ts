import { describe, expect, it, vi } from 'vitest';
import { map as createMap } from 'leaflet';
import '@tomickigrzegorz/leaflet-rotate';
import { mapBearingTarget, resolveNavigationHeading } from './navigationBearing';

describe('navigation bearing', () => {
  it('prefers a valid compass heading and falls back to GPS course', () => {
    expect(resolveNavigationHeading(90, 35)).toEqual({ heading: 90, source: 'compass' });
    expect(resolveNavigationHeading(null, 35)).toEqual({ heading: 35, source: 'gps' });
    expect(resolveNavigationHeading(Number.NaN, 35)).toEqual({ heading: 35, source: 'gps' });
    expect(resolveNavigationHeading(null, -1)).toEqual({ heading: null, source: 'none' });
  });

  it('turns heading to the top only in device follow mode', () => {
    expect(mapBearingTarget('follow', true, 90)).toBe(270);
    expect(mapBearingTarget('overview', true, 90)).toBe(0);
    expect(mapBearingTarget('free', true, 90)).toBeNull();
    expect(mapBearingTarget('follow', false, 90)).toBe(0);
    expect(mapBearingTarget('follow', true, null)).toBe(0);
  });

  it('crosses north by the short arc in both directions', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const map = createMap(container, {
      rotate: true,
      rotateControl: false,
      dragRotate: false,
      zoomControl: false,
    }).setView([43, -89], 15);
    try {
      map.setBearing(350);
      map.setHeading(350, { ease: 0.25 });
      vi.advanceTimersByTime(20);
      expect(map.getBearing()).toBeCloseTo(355);
      map.stopHeadingUp();
      map.setBearing(10);
      map.setHeading(10, { ease: 0.25 });
      vi.advanceTimersByTime(20);
      expect(map.getBearing()).toBeCloseTo(5);
    } finally {
      map.remove();
      container.remove();
      vi.useRealTimers();
    }
  });

  it('keeps geographic coordinates correct after rotated panning and zooming', () => {
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    document.body.append(container);
    const map = createMap(container, {
      rotate: true,
      rotateControl: false,
      dragRotate: false,
      zoomControl: false,
    }).setView([43, -89], 15);
    try {
      map.setBearing(270);
      const north = map.latLngToContainerPoint([43.001, -89]);
      expect(north.x).toBeLessThan(400);
      expect(north.y).toBeCloseTo(300);
      map.panBy([40, 30], { animate: false });
      map.setZoom(16, { animate: false });
      const screenPoint = map.latLngToContainerPoint([43.002, -89.003]);
      const restored = map.containerPointToLatLng(screenPoint);
      expect(restored.lat).toBeCloseTo(43.002, 4);
      expect(restored.lng).toBeCloseTo(-89.003, 4);
      expect(container.querySelector('.leaflet-rotate-pane')).not.toBeNull();
    } finally {
      map.remove();
      container.remove();
    }
  });
});
