import { expect, type Page } from '@playwright/test';

const DISCOVERY_URL = 'https://gbfs.bcycle.com/bcycle_madison/gbfs.json';
const INFORMATION_URL = 'https://gbfs.bcycle.com/bcycle_madison/station_information.json';
const STATUS_URL = 'https://gbfs.bcycle.com/bcycle_madison/station_status.json';
const APP_ORIGIN = 'http://127.0.0.1:4173';

export const ORIGIN_COORDINATES = '43.07310, -89.40120';
export const DESTINATION_COORDINATES = '43.07550, -89.38500';

export interface MockNetworkOptions {
  zeroBikes?: boolean;
  failStatusAfter?: number;
}

export interface MockNetworkCalls {
  geocoding: number;
  geocodingUrls: string[];
  stationInformation: number;
  stationStatus: number;
}

const stationInformation = [
  {
    station_id: 'pickup-recommended',
    name: 'Capitol Square',
    lat: 43.0732,
    lon: -89.4011,
  },
  {
    station_id: 'pickup-alternative',
    name: 'West Washington & Bedford',
    lat: 43.074,
    lon: -89.3997,
  },
  {
    station_id: 'dropoff-recommended',
    name: 'East Wilson & MLK',
    lat: 43.0755,
    lon: -89.385,
  },
  {
    station_id: 'dropoff-alternative',
    name: 'Monona Terrace',
    lat: 43.0762,
    lon: -89.3867,
  },
  {
    station_id: 'closed-station',
    name: 'Closed Station',
    lat: 43.0747,
    lon: -89.393,
  },
] as const;

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

function feedEnvelope(stations: readonly object[]) {
  return {
    last_updated: Math.floor(Date.now() / 1000),
    ttl: 3600,
    version: '1.1',
    data: { stations },
  };
}

/**
 * Installs one deterministic route handler for every app request. Only requests
 * to the local preview server are allowed through; all third-party traffic is
 * either fulfilled from these fixtures or blocked.
 */
export async function mockAppNetwork(
  page: Page,
  { zeroBikes = false, failStatusAfter }: MockNetworkOptions = {},
): Promise<MockNetworkCalls> {
  const calls: MockNetworkCalls = {
    geocoding: 0,
    geocodingUrls: [],
    stationInformation: 0,
    stationStatus: 0,
  };

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    if (url.startsWith(APP_ORIGIN)) {
      await route.continue();
      return;
    }

    if (url === DISCOVERY_URL) {
      await route.fulfill({
        json: {
          last_updated: Math.floor(Date.now() / 1000),
          ttl: 3600,
          version: '1.1',
          data: {
            en: {
              feeds: [
                { name: 'station_information', url: INFORMATION_URL },
                { name: 'station_status', url: STATUS_URL },
              ],
            },
          },
        },
      });
      return;
    }

    if (url === INFORMATION_URL) {
      calls.stationInformation += 1;
      await route.fulfill({ json: feedEnvelope(stationInformation) });
      return;
    }

    if (url === STATUS_URL) {
      calls.stationStatus += 1;
      if (failStatusAfter !== undefined && calls.stationStatus > failStatusAfter) {
        await route.fulfill({ status: 503, body: 'mocked station status failure' });
        return;
      }

      const stations = stationAvailability.map((station) => ({
        ...station,
        num_bikes_available: zeroBikes ? 0 : station.num_bikes_available,
      }));
      await route.fulfill({ json: feedEnvelope(stations) });
      return;
    }

    if (url.startsWith('https://photon.komoot.io/api')) {
      calls.geocoding += 1;
      calls.geocodingUrls.push(url);
      await route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-89.4012, 43.0731] },
              properties: { name: 'Capitol Square', city: 'Madison', state: 'Wisconsin' },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-89.3997, 43.074] },
              properties: {
                name: 'West Washington Avenue',
                city: 'Madison',
                state: 'Wisconsin',
              },
            },
          ],
        },
      });
      return;
    }

    if (url.startsWith('https://fonts.googleapis.com/')) {
      await route.fulfill({
        contentType: 'text/css',
        body: '/* Google Fonts is intentionally replaced during deterministic E2E tests. */',
      });
      return;
    }

    if (url.startsWith('https://fonts.gstatic.com/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.abort('blockedbyclient');
  });

  return calls;
}

export async function loadReadyApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Show station map' })).toBeEnabled();
}

export async function resolveCoordinates(
  page: Page,
  label: 'Starting location' | 'Destination',
  coordinates: string,
): Promise<void> {
  const input = page.getByRole('combobox', { name: label });
  await input.fill(coordinates);
  await input.press('Enter');
}
