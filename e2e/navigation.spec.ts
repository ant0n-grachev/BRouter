import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  DESTINATION_COORDINATES,
  loadReadyApp,
  mockAppNetwork,
  ORIGIN_COORDINATES,
  resolveCoordinates,
} from './fixtures';

const STATION_STATUS_URL = 'https://gbfs.bcycle.com/bcycle_madison/station_status.json';
const PICKUP = { lat: 43.0732, lon: -89.4011 };
const DROPOFF = { lat: 43.0755, lon: -89.385 };
const FAR_FROM_PICKUP = { lat: 43.069, lon: -89.41 };

type StationMode = 'normal' | 'pickup-empty' | 'stale' | 'failure';

interface NavigationTestHarness {
  setLocation: (lat: number, lon: number, accuracy?: number, heading?: number | null) => void;
  setCompassHeading: (heading: number) => void;
  setVisibility: (state: DocumentVisibilityState) => void;
  getSensorActivity: () => {
    compassPermissionRequests: number;
    currentPositionRequests: number;
    orientationListeners: number;
    positionWatches: number;
  };
}

type GeolocationPermissionState = 'granted' | 'denied' | 'prompt';

declare global {
  interface Window {
    __brouterNavigationTest: NavigationTestHarness;
  }
}

const stationAvailability = [
  {
    station_id: 'pickup-recommended',
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    num_bikes_available: 2,
    num_docks_available: 4,
  },
  {
    station_id: 'pickup-alternative',
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    num_bikes_available: 9,
    num_docks_available: 6,
  },
  {
    station_id: 'dropoff-recommended',
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    num_bikes_available: 3,
    num_docks_available: 2,
  },
  {
    station_id: 'dropoff-alternative',
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    num_bikes_available: 2,
    num_docks_available: 12,
  },
  {
    station_id: 'closed-station',
    is_installed: 0,
    is_renting: 0,
    is_returning: 0,
    num_bikes_available: 7,
    num_docks_available: 9,
  },
] as const;

async function installNavigationHarness(
  page: Page,
  emitInitialPosition: boolean,
  permissionState: GeolocationPermissionState,
): Promise<void> {
  await page.addInitScript(
    ({ initialLat, initialLon, shouldEmitInitialPosition, initialPermissionState }) => {
      let latitude = initialLat;
      let longitude = initialLon;
      let accuracy = 5;
      let heading: number | null = null;
      let visibilityState: DocumentVisibilityState = 'visible';
      let nextWatchId = 1;
      let compassPermissionRequests = 0;
      let currentPositionRequests = 0;
      let orientationListeners = 0;
      let positionWatches = 0;
      const watchers = new Map<number, PositionCallback>();

      const position = (): GeolocationPosition =>
        ({
          coords: {
            latitude,
            longitude,
            accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading,
            speed: null,
          },
          timestamp: Date.now(),
        }) as GeolocationPosition;

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibilityState,
      });
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success: PositionCallback) {
            currentPositionRequests += 1;
            if (shouldEmitInitialPosition) {
              window.setTimeout(() => success(position()), 0);
            }
          },
          watchPosition(success: PositionCallback) {
            positionWatches += 1;
            const watchId = nextWatchId;
            nextWatchId += 1;
            watchers.set(watchId, success);
            if (shouldEmitInitialPosition) {
              window.setTimeout(() => watchers.get(watchId)?.(position()), 0);
            }
            return watchId;
          },
          clearWatch(watchId: number) {
            watchers.delete(watchId);
          },
        },
      });
      const permissionStatus = new EventTarget() as PermissionStatus;
      Object.defineProperties(permissionStatus, {
        state: { configurable: true, get: () => initialPermissionState },
        onchange: { configurable: true, writable: true, value: null },
      });
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: () => Promise.resolve(permissionStatus),
        },
      });
      class MockDeviceOrientationEvent extends Event {}
      const orientationEvent = MockDeviceOrientationEvent;
      Object.defineProperty(orientationEvent, 'requestPermission', {
        configurable: true,
        value: () => {
          compassPermissionRequests += 1;
          return Promise.resolve('granted');
        },
      });
      Object.defineProperty(window, 'DeviceOrientationEvent', {
        configurable: true,
        value: orientationEvent,
      });
      for (const eventName of ['deviceorientationabsolute', 'deviceorientation']) {
        window.addEventListener(
          eventName,
          (event) => {
            if (event.isTrusted) event.stopImmediatePropagation();
          },
          true,
        );
      }
      const nativeAddEventListener = window.addEventListener.bind(window);
      window.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === 'deviceorientationabsolute' || type === 'deviceorientation') {
          orientationListeners += 1;
        }
        nativeAddEventListener(type, listener, options);
      }) as typeof window.addEventListener;

      window.__brouterNavigationTest = {
        setLocation(lat, lon, nextAccuracy = 5, nextHeading = null) {
          latitude = lat;
          longitude = lon;
          accuracy = nextAccuracy;
          heading = nextHeading;
          const nextPosition = position();
          watchers.forEach((success) => success(nextPosition));
        },
        setCompassHeading(nextHeading) {
          const screenOrientation = screen.orientation?.angle;
          const legacyOrientation = (window as Window & { orientation?: number }).orientation;
          const screenAngle = Number.isFinite(screenOrientation)
            ? screenOrientation
            : Number.isFinite(legacyOrientation)
              ? (legacyOrientation ?? 0)
              : 0;
          const event = new Event('deviceorientationabsolute');
          Object.defineProperties(event, {
            absolute: { configurable: true, value: true },
            alpha: {
              configurable: true,
              value: (((360 + screenAngle - nextHeading) % 360) + 360) % 360,
            },
          });
          window.dispatchEvent(event);
        },
        setVisibility(state) {
          visibilityState = state;
          document.dispatchEvent(new Event('visibilitychange'));
        },
        getSensorActivity() {
          return {
            compassPermissionRequests,
            currentPositionRequests,
            orientationListeners,
            positionWatches,
          };
        },
      };
    },
    {
      initialLat: FAR_FROM_PICKUP.lat,
      initialLon: FAR_FROM_PICKUP.lon,
      shouldEmitInitialPosition: emitInitialPosition,
      initialPermissionState: permissionState,
    },
  );
}

async function fulfillStationStatus(route: Route, mode: StationMode): Promise<void> {
  if (mode === 'failure') {
    await route.fulfill({ status: 503, body: 'mocked station status failure' });
    return;
  }

  const stations = stationAvailability.map((station) => ({
    ...station,
    num_bikes_available:
      (mode === 'pickup-empty' || mode === 'stale') && station.station_id === 'pickup-recommended'
        ? 0
        : station.num_bikes_available,
  }));
  const lastUpdated =
    mode === 'stale'
      ? Math.floor((Date.now() - 2 * 60 * 60 * 1_000) / 1_000)
      : Math.floor(Date.now() / 1_000);
  await route.fulfill({
    json: {
      last_updated: lastUpdated,
      ttl: mode === 'stale' ? 1 : 3_600,
      version: '1.1',
      data: { stations },
    },
  });
}

async function prepareNavigationNetwork(page: Page) {
  let stationMode: StationMode = 'normal';
  let stationStatusRequests = 0;
  await mockAppNetwork(page);
  await page.route(STATION_STATUS_URL, (route) => {
    stationStatusRequests += 1;
    return fulfillStationStatus(route, stationMode);
  });
  await page.route('**/.netlify/functions/route', async (route) => {
    const request: unknown = route.request().postDataJSON();
    if (
      typeof request !== 'object' ||
      request === null ||
      !('from' in request) ||
      !('to' in request)
    ) {
      await route.fulfill({ status: 400, json: { error: 'Invalid mocked route request.' } });
      return;
    }
    const { from, to } = request as {
      from: { lat: number; lon: number };
      to: { lat: number; lon: number };
    };
    await route.fulfill({
      json: {
        geometry: [from, to],
        instructions: [
          {
            text: 'Continue toward the active destination.',
            distanceMeters: 600,
            durationSeconds: 300,
            geometryIndex: 0,
          },
        ],
        distanceMeters: 600,
        durationSeconds: 300,
      },
    });
  });
  return {
    setStationMode(mode: StationMode) {
      stationMode = mode;
    },
    getStationStatusRequests() {
      return stationStatusRequests;
    },
  };
}

async function enterOrigin(page: Page, locationMode: 'device' | 'manual'): Promise<void> {
  await loadReadyApp(page);
  if (locationMode === 'device') {
    await page.getByRole('button', { name: 'Use my location', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Pickup station' })).toBeVisible();
  } else {
    await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  }
}

async function openNavigation(page: Page, locationMode: 'device' | 'manual' = 'device') {
  await enterOrigin(page, locationMode);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);
  await page.getByRole('button', { name: 'Go to navigation' }).click();
  const navigation = page.getByRole('main', { name: 'Trip navigation' });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole('button', { name: 'Walk to pickup', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  return navigation;
}

async function openPickupNavigation(page: Page, locationMode: 'device' | 'manual' = 'device') {
  await enterOrigin(page, locationMode);
  await page.getByRole('button', { name: 'Navigate to pickup' }).click();
  const navigation = page.getByRole('main', { name: 'Trip navigation' });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  return navigation;
}

async function setLocation(
  page: Page,
  point: { lat: number; lon: number },
  accuracy = 5,
  heading: number | null = null,
): Promise<void> {
  await page.evaluate(
    ({ lat, lon, nextAccuracy, nextHeading }) =>
      window.__brouterNavigationTest.setLocation(lat, lon, nextAccuracy, nextHeading),
    { ...point, nextAccuracy: accuracy, nextHeading: heading },
  );
}

async function setCompassHeading(page: Page, heading: number): Promise<void> {
  await page.evaluate(
    (nextHeading) => window.__brouterNavigationTest.setCompassHeading(nextHeading),
    heading,
  );
}

async function setVisibility(page: Page, state: DocumentVisibilityState): Promise<void> {
  await page.evaluate(
    (nextState) => window.__brouterNavigationTest.setVisibility(nextState),
    state,
  );
}

async function clickBcycleWithoutLaunching(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Get the BCycle app' })).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Open BCycle app' });
  await expect(link).toHaveAttribute('href', 'bcycle://');
  await link.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault(), { once: true });
  });
  await link.click();
}

const STAGE_BUTTONS = ['Walk to pickup', 'Ride to drop-off', 'Walk to destination'] as const;

async function expectActiveStage(
  navigation: Locator,
  activeStage: (typeof STAGE_BUTTONS)[number],
  target: string,
): Promise<void> {
  for (const name of STAGE_BUTTONS) {
    await expect(navigation.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      String(name === activeStage),
    );
  }
  await expect(navigation.getByTestId('navigation-target')).toHaveText(target);
}

async function refreshOnForeground(
  page: Page,
  network: Awaited<ReturnType<typeof prepareNavigationNetwork>>,
): Promise<void> {
  const requestCount = network.getStationStatusRequests();
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect.poll(() => network.getStationStatusRequests()).toBeGreaterThan(requestCount);
}

async function expectSilentAvailability(navigation: Locator): Promise<void> {
  await expect(navigation.getByText('Updating availability…', { exact: true })).toHaveCount(0);
  await expect(navigation.getByText('Updating', { exact: true })).toHaveCount(0);
}

async function expectNoLiveLocation(page: Page, navigation: Locator): Promise<void> {
  await expect(navigation.getByRole('region', { name: 'Route overview' })).toBeVisible();
  await expect(navigation.getByRole('region', { name: 'Next direction' })).toHaveCount(0);
  await expect(navigation.locator('.navigation-turn-distance')).toHaveCount(0);
  await expect(navigation.locator('.navigation-location-marker')).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Follow my location' })).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Use my location' })).toHaveCount(0);
  await expectMapBearing(navigation, 0);
  await expect
    .poll(() => page.evaluate(() => window.__brouterNavigationTest.getSensorActivity()))
    .toEqual({
      compassPermissionRequests: 0,
      currentPositionRequests: 0,
      orientationListeners: 0,
      positionWatches: 0,
    });
}

async function renderedRotation(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
  });
}

async function expectMapBearing(navigation: Locator, degrees: number): Promise<void> {
  await expect
    .poll(async () => {
      const rotatedPane = navigation.locator('.leaflet-rotate-pane');
      const actual = await renderedRotation(
        (await rotatedPane.count()) ? rotatedPane : navigation.locator('.leaflet-map-pane'),
      );
      return Math.abs(((actual - degrees + 540) % 360) - 180);
    })
    .toBeLessThan(1);
}

async function expectArrowFacingUp(navigation: Locator): Promise<void> {
  await expect
    .poll(() =>
      navigation.locator('.navigation-location-marker__heading').evaluate((element) => {
        let rotation = 0;
        for (let current: Element | null = element; current; current = current.parentElement) {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(current).transform);
          rotation += (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
          if (current.classList.contains('navigation-map__leaflet')) break;
        }
        return Math.abs((((rotation % 360) + 540) % 360) - 180);
      }),
    )
    .toBeLessThan(1);
}

async function markerDistanceFromMapCenter(navigation: Locator): Promise<number> {
  const mapBounds = await navigation.locator('.navigation-map__leaflet').boundingBox();
  const markerBounds = await navigation.locator('.navigation-location-marker').boundingBox();
  if (!mapBounds || !markerBounds) return Number.POSITIVE_INFINITY;
  const horizontal = markerBounds.x + markerBounds.width / 2 - (mapBounds.x + mapBounds.width / 2);
  const vertical = markerBounds.y + markerBounds.height / 2 - (mapBounds.y + mapBounds.height / 2);
  return Math.hypot(horizontal, vertical);
}

test.beforeEach(async ({ page }, testInfo) => {
  const permissionState: GeolocationPermissionState = testInfo.title.includes('permission prompt')
    ? 'prompt'
    : testInfo.title.includes('permission denied')
      ? 'denied'
      : 'granted';
  const emitInitialPosition =
    permissionState === 'granted' && !testInfo.title.includes('without GPS');
  await installNavigationHarness(page, emitInitialPosition, permissionState);
});

test('keeps manual pickup navigation route-only with granted location after reload', async ({
  page,
}) => {
  await prepareNavigationNetwork(page);
  let navigation = await openPickupNavigation(page, 'manual');
  await expectNoLiveLocation(page, navigation);
  await expect(navigation.getByRole('region', { name: 'Route overview' })).toContainText(
    'Walk to pickup',
  );
  await page.reload();
  navigation = page.getByRole('main', { name: 'Trip navigation' });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('heading', { name: 'Walk to pickup' })).toBeAttached();
  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  await expectNoLiveLocation(page, navigation);
  await expect(navigation.getByRole('region', { name: 'Route overview' })).toContainText(
    'Walk to pickup',
  );
});

for (const permission of ['permission prompt', 'permission denied'] as const) {
  test(`keeps ${permission} navigation quiet and manually usable on open`, async ({ page }) => {
    await prepareNavigationNetwork(page);
    const navigation = await openNavigation(page, 'manual');

    await expect(navigation.getByText('Finding your location…', { exact: true })).toHaveCount(0);
    await expect(
      navigation.getByText('Waiting for an accurate location.', { exact: true }),
    ).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: 'Retry location' })).toHaveCount(0);
    await expectNoLiveLocation(page, navigation);
    await expect(navigation.getByRole('button', { name: 'Show route' })).toBeVisible();

    await navigation.getByRole('button', { name: 'Walk to destination', exact: true }).click();
    await expectActiveStage(navigation, 'Walk to destination', DESTINATION_COORDINATES);
    await expect(navigation.getByText('Finding your location…', { exact: true })).toHaveCount(0);
  });
}

test('keeps manual full-trip navigation route-only with granted location after reload', async ({
  page,
}, testInfo) => {
  await prepareNavigationNetwork(page);
  let navigation = await openNavigation(page, 'manual');

  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');
  await expectNoLiveLocation(page, navigation);
  await expect(navigation.getByRole('region', { name: 'Route overview' })).toContainText(
    'Walk to pickup',
  );
  if (testInfo.project.name === 'mobile-chromium') {
    await page.screenshot({ path: '/tmp/brouter-manual-navigation-mobile.png', fullPage: true });
  }
  await expect(page.getByRole('link', { name: 'Open BCycle app' })).toHaveCount(0);

  await navigation.getByRole('button', { name: 'Walk to destination', exact: true }).click();
  await expectActiveStage(navigation, 'Walk to destination', DESTINATION_COORDINATES);

  await navigation.getByRole('button', { name: 'Ride to drop-off', exact: true }).click();
  await expectActiveStage(navigation, 'Ride to drop-off', 'East Wilson & MLK');

  await navigation.getByRole('button', { name: 'Walk to pickup', exact: true }).click();
  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');
  await page.reload();
  navigation = page.getByRole('main', { name: 'Trip navigation' });
  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');
  await expectNoLiveLocation(page, navigation);
});

test('reframes a manually selected leg after the rider drags the map without GPS', async ({
  page,
}) => {
  await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page, 'manual');
  await expect(navigation.getByRole('button', { name: 'Show route' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const map = navigation.locator('.navigation-map__leaflet');
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.min(180, bounds.width / 3), y, { steps: 4 });
  await page.mouse.up();

  await navigation.getByRole('button', { name: 'Walk to destination', exact: true }).click();
  await expectActiveStage(navigation, 'Walk to destination', DESTINATION_COORDINATES);
  await expect(
    navigation.locator('.leaflet-tooltip').filter({ hasText: 'Destination' }),
  ).toBeInViewport();
});

test('turns the map toward the compass in follow mode and restores a north-up overview', async ({
  page,
}, testInfo) => {
  await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  await setLocation(page, FAR_FROM_PICKUP, 500, 35);

  const follow = navigation.getByRole('button', { name: 'Follow my location' });
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const markerHeading = navigation.locator('.navigation-location-marker__heading');
  await expect(markerHeading).toHaveAttribute('data-heading', '35');
  await expect(markerHeading).toHaveAttribute('data-heading-source', 'gps');
  await expect(markerHeading.locator('.navigation-location-marker__arrow')).toBeVisible();
  await expect(markerHeading.locator('.navigation-location-marker__cone')).toBeVisible();
  await expectMapBearing(navigation, 0);

  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expectMapBearing(navigation, 325);
  await expectArrowFacingUp(navigation);
  await page.waitForTimeout(0);
  await setCompassHeading(page, 90);
  await expect(markerHeading).toHaveAttribute('data-heading', '90');
  await expect(markerHeading).toHaveAttribute('data-heading-source', 'compass');
  await expectMapBearing(navigation, 270);
  await expectArrowFacingUp(navigation);
  await expect.poll(() => markerDistanceFromMapCenter(navigation)).toBeLessThanOrEqual(5);
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: '/tmp/brouter-compass-desktop.png', fullPage: true });
  } else if (testInfo.project.name === 'mobile-chromium') {
    await page.screenshot({ path: '/tmp/brouter-compass-mobile.png', fullPage: true });
  }
  await setCompassHeading(page, 250);
  await expect(markerHeading).toHaveAttribute('data-heading', '250');
  await expectMapBearing(navigation, 110);
  await expectArrowFacingUp(navigation);

  await setCompassHeading(page, 350);
  await expectMapBearing(navigation, 10);
  await setCompassHeading(page, 10);
  await expectMapBearing(navigation, 350);
  await expectArrowFacingUp(navigation);

  const map = navigation.locator('.navigation-map__leaflet');
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const dragX = bounds.x + bounds.width * 0.75;
  const dragY = bounds.y + bounds.height * (bounds.width >= 800 ? 0.8 : 0.55);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - Math.min(120, bounds.width / 4), dragY, { steps: 4 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const pausedBearing = await renderedRotation(navigation.locator('.leaflet-rotate-pane'));
  await setCompassHeading(page, 120);
  await expect(markerHeading).toHaveAttribute('data-heading', '120');
  await expectMapBearing(navigation, pausedBearing);
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expectMapBearing(navigation, 240);
  await expectArrowFacingUp(navigation);
  await expect.poll(() => markerDistanceFromMapCenter(navigation)).toBeLessThanOrEqual(5);
  await expect(navigation.locator('.navigation-location-marker')).toBeInViewport();

  await navigation.getByRole('button', { name: 'Show route' }).click();
  await expectMapBearing(navigation, 0);
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await setCompassHeading(page, 215);
  await expect(markerHeading).toHaveAttribute('data-heading', '215');
  await expectMapBearing(navigation, 0);
});

test('opening BCycle and returning, hiding, or reloading never changes the selected leg', async ({
  page,
}) => {
  await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  await setLocation(page, PICKUP);
  await clickBcycleWithoutLaunching(page);
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');

  await page.reload();
  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');

  await navigation.getByRole('button', { name: 'Ride to drop-off', exact: true }).click();
  await setLocation(page, DROPOFF);
  await clickBcycleWithoutLaunching(page);
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expectActiveStage(navigation, 'Ride to drop-off', 'East Wilson & MLK');

  await page.reload();
  await expectActiveStage(navigation, 'Ride to drop-off', 'East Wilson & MLK');
});

test('persists a manually selected stage and ignores a legacy departed handoff', async ({
  page,
}) => {
  await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page, 'manual');
  await navigation.getByRole('button', { name: 'Walk to destination', exact: true }).click();
  await page.reload();
  await expectActiveStage(navigation, 'Walk to destination', DESTINATION_COORDINATES);

  await navigation.getByRole('button', { name: 'Walk to pickup', exact: true }).click();
  await page.evaluate(() => {
    const key = 'brouter:journey:v1';
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Expected a saved journey.');
    const saved = JSON.parse(raw) as Record<string, unknown>;
    delete saved.locationMode;
    saved.handoff = { stage: 'pickup', departed: true };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expectActiveStage(navigation, 'Walk to pickup', 'Capitol Square');
  await expectNoLiveLocation(page, navigation);
});

test('polls station availability and asks before replacing an unavailable station', async ({
  page,
}) => {
  await page.clock.install();
  const network = await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  await navigation.getByLabel('Navigation options').click();
  await expect(navigation.getByRole('radio', { name: 'Ask me first' })).toBeChecked();
  await expect(
    navigation.getByRole('button', { name: 'Refresh navigation station data' }),
  ).toHaveCount(0);
  await navigation.getByLabel('Navigation options').click();

  const requestCount = network.getStationStatusRequests();
  network.setStationMode('pickup-empty');
  await page.clock.fastForward(15_100);
  await expect.poll(() => network.getStationStatusRequests()).toBeGreaterThan(requestCount);

  await expect(navigation.getByText('Capitol Square has no bikes available.')).toBeVisible();
  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  await navigation.getByRole('button', { name: 'Use West Washington & Bedford' }).click();
  await expect(navigation.getByTestId('navigation-target')).toHaveText('West Washington & Bedford');
});

test('keeps live availability silent in the background and refreshes on return', async ({
  page,
}) => {
  await page.clock.install();
  const network = await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  await expect(navigation.locator('.navigation-availability')).toContainText('2 bikes · 4 docks');
  await expect(navigation.getByText('Live', { exact: true })).toHaveCount(0);
  await expectSilentAvailability(navigation);

  const requestCount = network.getStationStatusRequests();
  network.setStationMode('pickup-empty');
  await setVisibility(page, 'hidden');
  await page.clock.fastForward(15_100);
  expect(network.getStationStatusRequests()).toBe(requestCount);
  await expectSilentAvailability(navigation);

  await setVisibility(page, 'visible');
  await expect.poll(() => network.getStationStatusRequests()).toBeGreaterThan(requestCount);
  await expect(navigation.getByText('Capitol Square has no bikes available.')).toBeVisible();
  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  await expectSilentAvailability(navigation);
});

test('refreshes on foreground and automatically replaces an unavailable station when selected', async ({
  page,
}) => {
  const network = await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  await navigation.getByLabel('Navigation options').click();
  await navigation.getByRole('radio', { name: 'Change route automatically' }).check();
  network.setStationMode('pickup-empty');
  await refreshOnForeground(page, network);

  await expect(navigation.getByTestId('navigation-target')).toHaveText('West Washington & Bedford');
  await expect(navigation.getByText('Pickup changed to West Washington & Bedford.')).toBeVisible();
});

test('does not automatically replace a station from stale station data', async ({ page }) => {
  const network = await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  const availability = navigation.locator('.navigation-availability');
  await expect(availability).toContainText('2 bikes · 4 docks');
  await navigation.getByLabel('Navigation options').click();
  await navigation.getByRole('radio', { name: 'Change route automatically' }).check();
  network.setStationMode('stale');
  await refreshOnForeground(page, network);

  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  await expect(availability).toContainText('0 bikes · 4 docks');
  await expect(navigation.getByText('Last known', { exact: true })).toHaveCount(0);
  await expectSilentAvailability(navigation);
  await expect(navigation.getByText(/Pickup changed to/)).toHaveCount(0);
});

test('does not automatically replace a station when station refresh fails', async ({ page }) => {
  const network = await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);
  const availability = navigation.locator('.navigation-availability');
  await expect(availability).toContainText('2 bikes · 4 docks');
  await navigation.getByLabel('Navigation options').click();
  await navigation.getByRole('radio', { name: 'Change route automatically' }).check();
  network.setStationMode('failure');
  await refreshOnForeground(page, network);

  await expect(navigation.getByTestId('navigation-target')).toHaveText('Capitol Square');
  await expect(availability).toContainText('2 bikes · 4 docks');
  await expect(navigation.getByText('Last known', { exact: true })).toHaveCount(0);
  await expectSilentAvailability(navigation);
  await expect(navigation.getByText(/Pickup changed to/)).toHaveCount(0);
});

test('keeps the navigation layout within the viewport without serious accessibility violations', async ({
  page,
}, testInfo) => {
  await prepareNavigationNetwork(page);
  const navigation = await openNavigation(page);

  await expect(navigation.locator('.navigation-turn-banner')).toBeVisible();
  const map = navigation.locator('.navigation-map');
  await expect(map).toBeVisible();
  await expect(navigation.locator('.navigation-bottom')).toBeVisible();
  await expect(navigation.getByText('All directions', { exact: true })).toHaveCount(0);
  await expect(
    navigation.getByText('Availability updates automatically every 15 seconds.', { exact: true }),
  ).toHaveCount(0);
  await expect(navigation.getByText(/Location accuracy:/)).toHaveCount(0);
  const routeDrawingSurface = navigation.locator('.leaflet-overlay-pane > svg');
  await expect(routeDrawingSurface).toBeVisible();
  const [mapWidth, routeDrawingWidth] = await Promise.all([
    map.evaluate((element) => element.getBoundingClientRect().width),
    routeDrawingSurface.evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(routeDrawingWidth).toBeGreaterThanOrEqual(mapWidth / 2);

  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: '/tmp/brouter-navigation-desktop.png', fullPage: true });
  } else if (testInfo.project.name === 'mobile-chromium') {
    await page.screenshot({ path: '/tmp/brouter-navigation-mobile.png', fullPage: true });
  }

  const overflow = await navigation.evaluate((element) => ({
    horizontal: element.scrollWidth - element.clientWidth,
    viewportHorizontal: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.viewportHorizontal).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .include('main[aria-label="Trip navigation"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
});
