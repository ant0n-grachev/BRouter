import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Route } from '@playwright/test';
import {
  DESTINATION_COORDINATES,
  loadReadyApp,
  mockAppNetwork,
  ORIGIN_COORDINATES,
  resolveCoordinates,
} from './fixtures';

declare global {
  interface Window {
    __completePlannerLocation?: () => boolean;
  }
}

test('loads cleanly without console errors or a framework overlay', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !(
        testInfo.project.name === 'mobile-webkit' &&
        message.text() ===
          "Service worker registration failed. TypeError: undefined is not an object (evaluating 'r.fn.waiting')"
      )
    ) {
      browserErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await mockAppNetwork(page);

  await loadReadyApp(page);

  await expect(page).toHaveTitle(/BRouter/i);
  const title = page.getByRole('heading', { level: 1, name: /Madison's BRouter/ });
  const byline = page.getByRole('link', { name: 'by Anton' });
  await expect(title).toBeVisible();
  await expect(byline).toHaveAttribute('href', 'https://anton.grachev.us');
  await expect(byline).toHaveCSS('text-decoration-line', 'none');

  const titleBox = await title.boundingBox();
  const bylineBox = await byline.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(bylineBox).not.toBeNull();
  expect((bylineBox?.y ?? 0) - (titleBox?.y ?? 0)).toBeLessThan((titleBox?.height ?? 0) + 8);
  expect((bylineBox?.x ?? 0) - ((titleBox?.x ?? 0) + (titleBox?.width ?? 0))).toBeLessThan(32);
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: '/tmp/brouter-cleanup-empty-desktop.png', fullPage: true });
  } else if (testInfo.project.name === 'mobile-chromium') {
    await page.screenshot({ path: '/tmp/brouter-cleanup-empty-mobile.png', fullPage: true });
  }
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('uses concise map, search, and attribution copy', async ({ page }) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);

  await expect(page.getByRole('heading', { name: 'Service Area Map' })).toBeVisible();
  const searchHints = page.getByText('Type at least 3 characters.', { exact: true });
  await expect(searchHints).toHaveCount(2);
  for (const [index, label] of ['Starting location', 'Destination'].entries()) {
    const hint = searchHints.nth(index);
    await expect(hint).toHaveClass(/visually-hidden/);
    const hintId = await hint.getAttribute('id');
    expect(hintId).toBeTruthy();
    await expect(page.getByRole('combobox', { name: label })).toHaveAttribute(
      'aria-describedby',
      new RegExp(`(^|\\s)${hintId}(\\s|$)`),
    );
  }
  await expect(page.locator('.app-header .eyebrow, .app-header .app-subtitle')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toHaveCount(0);
  await expect(page.locator('input[name="origin-mode"]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Starting location' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh station data' })).toHaveCount(0);
  await expect(page.getByText(/Last successful refresh:/)).toHaveCount(0);
  await expect(page.getByText('Based on station locations;', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Address search attribution and privacy')).toHaveCount(0);

  await expect(
    page.locator('.app-footer a[href="https://www.openstreetmap.org/copyright"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Show station map' }).click();
  const attribution = page
    .locator('.leaflet-control-attribution')
    .getByRole('link', { name: 'OpenStreetMap' });
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
});

test('keeps About collapsed and reveals install instructions from the keyboard', async ({
  page,
}) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);

  const about = page.locator('details').filter({ hasText: 'About BRouter' });
  await expect(about).not.toHaveAttribute('open', '');
  await expect(about.getByText(/Independent community tool/)).toBeHidden();

  const disclosure = page.locator('details').filter({ hasText: 'Install app' });
  const summary = disclosure.locator('summary');

  await expect(summary).toBeVisible();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(disclosure.getByText('iPhone/iPad:', { exact: true })).toBeHidden();
  await expect(disclosure.getByText('Android:', { exact: true })).toBeHidden();

  await summary.focus();
  await summary.press('Enter');

  await expect(disclosure).toHaveAttribute('open', '');
  await expect(disclosure.getByText('iPhone/iPad:', { exact: true })).toBeVisible();
  await expect(disclosure.getByText('Android:', { exact: true })).toBeVisible();
  await expect(disclosure.locator('.app-install__instructions p')).toHaveText([
    /iPhone\/iPad:.*Safari.*Share.*Add to Home Screen.*Open as Web App.*Add/,
    /Android:.*Chrome.*three-dot menu.*Install app.*Add to Home screen.*prompts/,
  ]);
});

for (const installedMode of ['standalone', 'ios'] as const) {
  test(`hides install instructions in ${installedMode} web-app mode`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === 'ios') {
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      } else {
        const originalMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = originalMatchMedia(query);
          if (query.includes('display-mode: standalone')) {
            Object.defineProperty(result, 'matches', { value: true });
          }
          return result;
        };
      }
    }, installedMode);
    await mockAppNetwork(page);
    await loadReadyApp(page);

    await expect(page.locator('.app-footer')).toBeVisible();
    await expect(page.getByText('About BRouter', { exact: true })).toBeVisible();
    await expect(page.getByText('Install app', { exact: true })).toHaveCount(0);
  });
}

test('serves a manifest with a stable root app identity', async ({ page }) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);

  const manifestText = await page.evaluate(async () => {
    const response = await fetch('/manifest.json');
    return response.text();
  });
  const manifest: unknown = JSON.parse(manifestText);

  expect(manifest).toMatchObject({
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f7fb',
    theme_color: '#f4f7fb',
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f7fb');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
});

test('shows exact bikes/docks counts with distinct availability colors on the map', async ({
  page,
}) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);

  const toggle = page.getByRole('button', { name: 'Show station map' });
  await expect(toggle).toHaveText(/^Show$/);
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Hide station map' })).toHaveText(/^Hide$/);

  const legend = page.getByLabel('Station map legend');
  await expect(legend.getByText('Bikes / docks')).toBeVisible();
  const examples = legend.locator('.station-map__legend-symbol');
  await expect(examples).toHaveText(['2/2', '2/0', '0/2', '0/0']);
  await expect(examples.nth(0)).toHaveCSS('background-color', 'rgb(109, 40, 217)');
  await expect(examples.nth(1)).toHaveCSS('background-color', 'rgb(3, 105, 161)');
  await expect(examples.nth(2)).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  await expect(examples.nth(3)).toHaveCSS('background-color', 'rgb(185, 28, 28)');

  await expect(page.locator('.station-map__marker').filter({ hasText: '2/4' })).toBeVisible();
  await expect(page.locator('.station-map__marker--disabled')).toHaveText('×');
});

test('selects eligible pickup and drop-off stations from the map and synchronizes the trip', async ({
  page,
}) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);

  await page.getByRole('button', { name: 'Show station map' }).click();

  const pickupChoices = page.getByRole('group', { name: 'Pickup station' });
  const dropoffChoices = page.getByRole('group', { name: 'Drop-off station' });
  await expect(page.locator('a[href*="google.com/maps"]')).toHaveCount(0);

  await page.locator('[title^="West Washington & Bedford:"]').click();
  await page.getByRole('button', { name: 'Choose West Washington & Bedford as pickup' }).click();

  await expect(
    pickupChoices.getByRole('radio', { name: /West Washington & Bedford/ }),
  ).toBeChecked();
  await expect(page.locator('[title^="West Washington & Bedford:"]')).toHaveClass(
    /station-map__marker-container/,
  );
  await expect(
    page.locator('[title^="West Washington & Bedford:"] .station-map__marker'),
  ).toHaveClass(/station-map__marker--selected/);

  await page.locator('[title^="Monona Terrace:"]').click();
  await page.getByRole('button', { name: 'Choose Monona Terrace as drop-off' }).click();

  await expect(dropoffChoices.getByRole('radio', { name: /Monona Terrace/ })).toBeChecked();
  await expect(page.locator('[title^="Monona Terrace:"] .station-map__marker')).toHaveClass(
    /station-map__marker--selected/,
  );
});

test('automatically searches manual origin and lets Enter choose the first result', async ({
  page,
}) => {
  const calls = await mockAppNetwork(page);
  await loadReadyApp(page);
  const input = page.getByRole('combobox', { name: 'Starting location' });

  await input.pressSequentially('Capitol Square');
  expect(calls.geocoding).toBe(0);
  await expect(
    page.getByRole('button', { name: /Search (starting location|destination)/ }),
  ).toHaveCount(0);
  await expect(input).toBeFocused();

  await expect.poll(() => calls.geocoding).toBe(1);
  const request = new URL(calls.geocodingUrls[0] ?? '');
  expect(request.searchParams.get('bbox')).toBeTruthy();
  const firstResult = page.getByRole('option', {
    name: 'Capitol Square, Madison, Wisconsin',
  });
  await expect(firstResult).toBeVisible();

  await input.press('Enter');

  await expect(input).toHaveValue('Capitol Square, Madison, Wisconsin');
  await expect(page.getByRole('group', { name: 'Pickup station' })).toBeVisible();
  expect(calls.geocoding).toBe(1);
});

test('automatically searches destination within the current station service area', async ({
  page,
}) => {
  const calls = await mockAppNetwork(page);
  await loadReadyApp(page);
  const input = page.getByRole('combobox', { name: 'Destination' });

  await input.fill('State Street');
  expect(calls.geocoding).toBe(0);
  await expect(page.getByRole('button', { name: 'Search destination' })).toHaveCount(0);
  await expect(input).toBeFocused();

  await expect.poll(() => calls.geocoding).toBe(1);
  await expect(page.getByRole('option', { name: /Capitol Square/ })).toBeVisible();
  const request = new URL(calls.geocodingUrls[0] ?? '');
  expect(request.searchParams.get('bbox')).toBeTruthy();
});

test('resolves coordinates locally without a Photon request', async ({ page }) => {
  const calls = await mockAppNetwork(page);
  await loadReadyApp(page);

  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);

  await expect(page.getByRole('combobox', { name: 'Starting location' })).toHaveValue(
    ORIGIN_COORDINATES,
  );
  await expect(page.getByRole('group', { name: 'Pickup station' })).toBeVisible();
  expect(calls.geocoding).toBe(0);
});

test('offers in-app navigation to the selected pickup without requiring a destination', async ({
  page,
}) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);

  const pickupNavigation = page.getByRole('button', { name: 'Navigate to pickup' });
  await expect(pickupNavigation).toBeVisible();
  await expect(page.locator('a[href*="google.com/maps"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toHaveCount(0);

  await page
    .getByRole('group', { name: 'Pickup station' })
    .getByRole('radio', { name: /West Washington & Bedford/ })
    .check();

  await expect(
    page
      .getByRole('group', { name: 'Pickup station' })
      .getByRole('radio', { name: /West Washington & Bedford/ }),
  ).toBeChecked();
  await expect(pickupNavigation).toBeVisible();
});

test('defaults to the closest stations and keeps alternative selections current', async ({
  page,
}, testInfo) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);

  const pickupChoices = page.getByRole('group', { name: 'Pickup station' });
  const dropoffChoices = page.getByRole('group', { name: 'Drop-off station' });
  await expect(pickupChoices.locator('.station-choice__badge')).toHaveText([
    'Closest',
    'Nearby',
    'More bikes',
  ]);
  await expect(dropoffChoices.locator('.station-choice__badge')).toHaveText([
    'Closest',
    'Nearby',
    'More docks',
  ]);
  await expect(pickupChoices.getByRole('radio', { name: /Capitol Square/ })).toBeChecked();
  await expect(dropoffChoices.getByRole('radio', { name: /East Wilson & MLK/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: '/tmp/brouter-cleanup-planned-desktop.png', fullPage: true });
  } else if (testInfo.project.name === 'mobile-chromium') {
    await page.screenshot({ path: '/tmp/brouter-cleanup-planned-mobile.png', fullPage: true });
  }

  const alternative = pickupChoices.getByRole('radio', {
    name: /West Washington & Bedford/,
  });
  await alternative.check();
  await expect(alternative).toBeChecked();
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toBeVisible();
  await expect(page.locator('a[href*="google.com/maps"]')).toHaveCount(0);
});

test('reports zero bikes without claiming a seasonal closure', async ({ page }) => {
  await mockAppNetwork(page, { zeroBikes: true });
  await page.goto('/');
  await expect(page.getByText('No bikes available right now.')).toBeVisible();

  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);

  await expect(
    page.getByText('No bikes are currently available at installed rental stations.'),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/season|seasonal/i);
});

test('keeps the last successful station counts quietly after an automatic refresh fails', async ({
  page,
}) => {
  const calls = await mockAppNetwork(page, { failStatusAfter: 1 });
  await loadReadyApp(page);
  await page.getByRole('button', { name: 'Show station map' }).click();
  const cachedStation = page.locator('.station-map__marker').filter({ hasText: '2/4' });
  await expect(cachedStation).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));

  await expect(cachedStation).toBeVisible();
  await expect(page.getByText('Availability may be out of date.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByText(/Last successful refresh:/)).toHaveCount(0);
  expect(calls.stationStatus).toBeGreaterThanOrEqual(2);
});

test('uses mocked device geolocation without switching to manual mode', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['geolocation'], {
    origin: 'http://127.0.0.1:4173',
  });
  await context.setGeolocation({ latitude: 43.0731, longitude: -89.4012 });
  await mockAppNetwork(page);
  await loadReadyApp(page);

  await page.getByRole('button', { name: 'Use my location', exact: true }).click();

  await expect(page.getByText(/Device location received:/)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Starting location' })).toHaveValue(
    'My location',
  );
  await expect(page.getByRole('group', { name: 'Pickup station' })).toBeVisible();

  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toBeVisible();
});

test('uses a typed starting address as manual origin after device location', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 43.074, longitude: -89.3997 });
  await mockAppNetwork(page);
  await page.route('**/.netlify/functions/route', (route) =>
    route.fulfill({
      json: {
        geometry: [
          { lat: 43.0731, lon: -89.4012 },
          { lat: 43.0732, lon: -89.4011 },
        ],
        instructions: [],
        distanceMeters: 100,
        durationSeconds: 60,
      },
    }),
  );
  await loadReadyApp(page);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  const origin = page.getByRole('combobox', { name: 'Starting location' });
  await expect(origin).toHaveValue('My location');
  await expect(page.getByRole('group', { name: 'Pickup station' })).toBeVisible();
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);

  await origin.fill('Capitol Square');
  await page.getByRole('option', { name: 'Capitol Square, Madison, Wisconsin' }).click();
  await expect(origin).toHaveValue('Capitol Square, Madison, Wisconsin');
  await page.getByRole('button', { name: 'Go to navigation' }).click();
  await expect(page.getByRole('main', { name: 'Trip navigation' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Route overview' })).toBeVisible();
  const saved: unknown = await page.evaluate(() => {
    const journey: unknown = JSON.parse(localStorage.getItem('brouter:journey:v1') ?? 'null');
    return journey;
  });
  expect(saved).toMatchObject({ locationMode: 'manual', origin: { lat: 43.0731, lon: -89.4012 } });
});

test('Clear empties both fields and trip selections and ignores a late device result', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let callback: PositionCallback | null = null;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          callback = success;
        },
      },
    });
    window.__completePlannerLocation = () => {
      if (!callback) return false;
      callback({
        coords: {
          latitude: 43.074,
          longitude: -89.3997,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
      return true;
    };
  });
  await mockAppNetwork(page);
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toBeVisible();

  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Starting location' })).toHaveValue(
    'My location',
  );
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  expect(await page.evaluate(() => window.__completePlannerLocation?.())).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Starting location' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Destination' })).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Pickup station' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Drop-off station' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Navigate to pickup' })).toHaveCount(0);
});

test('Clear cancels a pending starting-address search and empties the destination', async ({
  page,
}) => {
  await mockAppNetwork(page);
  let pendingSearch: Route | undefined;
  let searchCancelled = false;
  await page.route('https://photon.komoot.io/api*', (route) => {
    pendingSearch = route;
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('https://photon.komoot.io/api')) searchCancelled = true;
  });
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Starting location' }).fill('Deferred Capitol');
  await expect.poll(() => Boolean(pendingSearch)).toBe(true);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => searchCancelled).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Starting location' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Destination' })).toHaveValue('');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go to navigation' })).toHaveCount(0);
});

test('switches an out-of-area device location to manual origin entry', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['geolocation'], {
    origin: 'http://127.0.0.1:4173',
  });
  await context.setGeolocation({ latitude: 44, longitude: -89 });
  await mockAppNetwork(page);
  await loadReadyApp(page);

  await page.getByRole('button', { name: 'Use my location', exact: true }).click();

  await expect(page.getByRole('combobox', { name: 'Starting location' })).toBeVisible();
  await expect(
    page.getByText(
      'Your device location is outside the current BCycle service area. Enter a starting location instead.',
    ),
  ).toBeVisible();
});

test('has no serious or critical Axe violations in the planned-trip view', async ({ page }) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);
  await resolveCoordinates(page, 'Starting location', ORIGIN_COORDINATES);
  await resolveCoordinates(page, 'Destination', DESTINATION_COORDINATES);
  const installDisclosure = page.locator('details.app-install').filter({ hasText: 'Install app' });
  await installDisclosure.locator('summary').click();
  await expect(installDisclosure).toHaveAttribute('open', '');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const severeViolations = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(severeViolations).toEqual([]);
});

test('loads the app shell offline and does not return HTML for a failed asset request', async ({
  context,
  page,
}, testInfo) => {
  await mockAppNetwork(page);
  await loadReadyApp(page);

  if (testInfo.project.name !== 'mobile-webkit') {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The first reload places the page under the generated Workbox service worker.
    await page.reload();
    await page.getByRole('heading', { level: 1, name: /Madison's BRouter/ }).waitFor();
  }

  const failedAsset = await page.evaluate(async () => {
    const response = await fetch('/assets/definitely-missing.js');
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: (await response.text()).slice(0, 100).toLowerCase(),
    };
  });
  expect(failedAsset.status).toBe(404);
  expect(failedAsset.contentType ?? '').not.toContain('text/html');
  expect(failedAsset.body).not.toContain('<!doctype html');

  if (testInfo.project.name === 'mobile-webkit') {
    // WebKit reports an internal error when reloading an offline document.
    // Keep the loaded shell mounted and exercise the app's offline signal.
    await page.evaluate(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    await context.setOffline(true);
  } else {
    // Route interception keeps Playwright's navigator.onLine value true even
    // while its network is disconnected, so make that browser signal explicit
    // for the new offline document.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  await expect(page.getByRole('heading', { level: 1, name: /Madison's BRouter/ })).toBeVisible();
  await expect(
    page.getByText('You’re offline. Reconnect to search and see current availability.'),
  ).toBeVisible();

  await context.setOffline(false);
});
