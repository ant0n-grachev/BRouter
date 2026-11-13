# BRouter

Plan a Madison BCycle trip with available pickup bikes and return docks, then follow walking and cycling directions in the app.

## Overview

BRouter helps riders choose both ends of a bike-share trip. Enter a starting point and destination to compare nearby stations. Choose a pickup and return station, then open the map for the walk to the bike, the ride, and the final walk. You can also navigate to a pickup station with just a starting point.

## Demo

[Open BRouter](https://bcycle-router.netlify.app/) · [Watch the planner walkthrough](https://github.com/user-attachments/assets/e3689c4c-f612-4196-b2c7-ded43c66002c)

## Features

- Compare up to three pickup and three return stations using live Madison BCycle availability.
- Search for addresses, enter coordinates, or choose to use your current location.
- Follow an active leg with turn instructions and estimated time remaining, or use a route overview without granting location access.
- Review or automatically accept station alternatives when fresh availability changes. BRouter saves the active trip on your device.
- Install the progressive web app (PWA) for an offline app shell. Live planning still needs a connection.

## How it works

The browser joins and validates Madison BCycle’s GBFS station and availability feeds. It ranks eligible stations within one mile of each endpoint by Haversine distance and considers availability when recommending alternatives. These straight-line estimates help compare stations. In-app directions, route geometry, travel distances, and durations come from openrouteservice through a same-origin function with a server-side API key.

## Tech stack

- **React and TypeScript** for the planner, navigation, and client-side state.
- **Leaflet and OpenStreetMap** for maps, **Photon** for address lookup, and **GBFS** for station data.
- **Netlify Functions** for openrouteservice requests. **Vite and Workbox** build the app and its offline shell.

## Getting started

Use Node.js 22 (the CI version) and npm. The planner needs network access to Madison BCycle’s GBFS feeds, and address search uses Photon.

```bash
git clone https://github.com/ant0n-grachev/BRouter.git
cd BRouter
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. Run `npm run build` and `npm run preview` to inspect the production bundle locally.

## Configuration

Copy [`.env.example`](.env.example) to `.env.local` and set `OPENROUTESERVICE_API_KEY` with a key from [openrouteservice](https://openrouteservice.org/dev/) to enable local directions. Keep it server-side, without a `VITE_` prefix, and restart Vite after changes. The planner works without a routing key. Netlify uses the same variable in its Functions environment. **Ask me first** is the default when availability changes.

Address queries go directly to Photon. Coordinates needed for directions go through the routing function to openrouteservice. See [data handling and provider attribution](docs/OPERATING.md#address-search-attribution-and-privacy).

## Testing

[![CI](https://github.com/ant0n-grachev/BRouter/actions/workflows/ci.yml/badge.svg)](https://github.com/ant0n-grachev/BRouter/actions/workflows/ci.yml)

```bash
npm run check:version
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Vitest covers route progress, station ranking, routing responses, and UI components. Playwright uses fixtures in desktop Chromium and mobile Chromium and WebKit profiles for planner and navigation flows, including Axe checks. Physical-device GPS, compass, wake lock, PWA installation, and the BCycle app handoff require separate verification.

## Limitations

- BRouter serves Madison BCycle. Station reports can lag or change en route. The coverage map estimates the service area from installed stations.
- BRouter does not reserve bikes or docks, unlock bikes, take payments, or confirm returns. Its station handoff opens the BCycle app.
- Directions cover one active leg at a time. Current availability, new directions, and uncached searches require the respective external services.

## Project structure

| Path                                                       | Responsibility                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| [`src/features/trip-planner`](src/features/trip-planner)   | Origin and destination, station selection, and trip planning |
| [`src/features/navigation`](src/features/navigation)       | Journey stages, route progress, and map guidance             |
| [`src/lib`](src/lib) and [`src/services`](src/services)    | Station ranking, feed validation, and address lookup         |
| [`src/server/routeHandler.ts`](src/server/routeHandler.ts) | Routing validation, throttling, and caching                  |
| [`netlify/functions`](netlify/functions) and [`e2e`](e2e)  | Hosting entry point and fixture-based browser tests          |

See [How BRouter works](docs/OPERATING.md) for station ranking, route behavior, data handling, and deployment configuration.

## Versioning and credits

The prepared application version is **v0.1.1** (unreleased). BRouter uses [Semantic Versioning](https://semver.org/). [`package.json`](package.json) is the version source, and Git tags for published versions use `vX.Y.Z`. See the [changelog](CHANGELOG.md) for unreleased changes.

BRouter is an independent project by Anton Grachev under the [MIT License](LICENSE). See the [data providers and attribution](docs/OPERATING.md#data-sources-and-independence). Report issues or propose changes in the [canonical repository](https://github.com/ant0n-grachev/BRouter).
