import { describe, expect, it } from 'vitest';
import {
  isDisplayableFix,
  isNearTarget,
  isUsableFix,
  type LocationFix,
} from './navigationLocation';

const NOW = 2_000_000;

function fix(overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    lat: 43.0731,
    lon: -89.4012,
    accuracy: 10,
    timestamp: NOW,
    heading: null,
    ...overrides,
  };
}

describe('isDisplayableFix', () => {
  it('accepts a recent coarse fix without making it usable for routing', () => {
    const coarseFix = fix({ accuracy: 500 });

    expect(isDisplayableFix(coarseFix, NOW)).toBe(true);
    expect(isUsableFix(coarseFix, NOW)).toBe(false);
  });

  it.each([
    ['missing', null],
    ['stale', fix({ timestamp: NOW - 30_001 })],
    ['invalid coordinates', fix({ lon: -180.01 })],
    ['invalid accuracy', fix({ accuracy: Number.POSITIVE_INFINITY })],
    ['negative accuracy', fix({ accuracy: -1 })],
    ['invalid timestamp', fix({ timestamp: Number.NaN })],
  ])('rejects a %s fix', (_case, locationFix) => {
    expect(isDisplayableFix(locationFix, NOW)).toBe(false);
  });
});

describe('isUsableFix', () => {
  it('accepts a recent fix with valid coordinates and at most 50 meter accuracy', () => {
    expect(isUsableFix(fix({ accuracy: 50, timestamp: NOW - 30_000 }), NOW)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['inaccurate', fix({ accuracy: 50.01 })],
    ['stale', fix({ timestamp: NOW - 30_001 })],
    ['non-finite latitude', fix({ lat: Number.NaN })],
    ['out-of-range latitude', fix({ lat: 90.01 })],
    ['out-of-range longitude', fix({ lon: -180.01 })],
    ['negative accuracy', fix({ accuracy: -1 })],
    ['non-finite timestamp', fix({ timestamp: Number.POSITIVE_INFINITY })],
    ['far-future timestamp', fix({ timestamp: NOW + 5_001 })],
  ])('rejects a %s fix', (_case, locationFix) => {
    expect(isUsableFix(locationFix, NOW)).toBe(false);
  });

  it('allows at most five seconds of device clock skew into the future', () => {
    expect(isUsableFix(fix({ timestamp: NOW + 5_000 }), NOW)).toBe(true);
  });
});

describe('isNearTarget', () => {
  it('includes reported accuracy in the 100 meter proximity boundary', () => {
    const locationFix = fix({ accuracy: 40 });

    expect(isNearTarget(locationFix, { lat: 43.07355, lon: -89.4012 }, NOW)).toBe(true);
    expect(isNearTarget(locationFix, { lat: 43.07375, lon: -89.4012 }, NOW)).toBe(false);
  });

  it('rejects stale fixes and invalid targets', () => {
    expect(
      isNearTarget(fix({ timestamp: NOW - 30_001 }), { lat: 43.0731, lon: -89.4012 }, NOW),
    ).toBe(false);
    expect(isNearTarget(fix(), { lat: Number.NaN, lon: -89.4012 }, NOW)).toBe(false);
  });
});
