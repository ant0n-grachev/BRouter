# BRouter Mobile Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining mobile map obstruction, make recovery from address-search failures explicit, and verify the app in an iPhone-sized WebKit browser.

**Architecture:** Keep the existing React component boundaries. Move Leaflet's zoom control away from popup content through the React-Leaflet control API, expose retry through the existing `runSearch` state machine, and extend the existing Playwright project matrix without adding dependencies.

**Tech Stack:** React 19, TypeScript, React-Leaflet/Leaflet, Vitest and Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-hardening.md`

## Global Constraints

- Preserve automatic debounced address search and service-area-only results.
- Never show the normal Search button while `searchAfterPause` is enabled.
- Do not reorder the planner and Service Area Map.
- Add no production dependencies.
- Do not deploy, push, or commit; preserve all pre-existing working-tree changes.
- Write and run a failing behavioral test before each production behavior change.
- Store screenshots and temporary reports outside tracked source.

---

### Task 1: Mobile station popup and map guidance

**Files:**

- Modify: `src/components/StationMap.tsx:47-52`
- Modify: `src/components/StationMap.test.tsx:35-57`
- Modify: `src/components/StationMapLeaflet.tsx:1-5,87-100`
- Modify: `src/components/StationMapLeaflet.test.tsx:7-23,40-179`

**Interfaces:**

- Consumes: existing `StationMapProps` and React-Leaflet `MapContainer`/`ZoomControl` APIs.
- Produces: a bottom-right Leaflet zoom control and planned-trip help that says candidate markers can be tapped to choose a role.

- [ ] **Step 1: Write the failing map-help test**

Update the planned-trip assertion to require this complete visible sentence:

```text
Showing your pickup and drop-off choices. Tap a candidate marker to view details and choose pickup or drop-off. Selected stations have a bold outline. Use the map controls or arrow keys to move the map.
```

- [ ] **Step 2: Write the failing zoom-position test**

Extend the `react-leaflet` mock with a `ZoomControl` spy and assert that `StationMapLeaflet` disables the default control and renders the explicit control with `position="bottomright"`. This catches a regression that returns the control to the popup's top-left region.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- --run src/components/StationMap.test.tsx src/components/StationMapLeaflet.test.tsx
```

Expected: failures for the missing marker-tap copy and the missing bottom-right control.

- [ ] **Step 4: Implement the minimal map change**

Use an explicit React-Leaflet control:

```tsx
<MapContainer zoomControl={false} ...>
  <ZoomControl position="bottomright" />
  ...
</MapContainer>
```

Update only the planned-trip hint copy; keep the overview copy and selection behavior unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused Vitest command and require zero failures or warnings.

### Task 2: Error-only address-search retry

**Files:**

- Modify: `src/components/LocationSearch.test.tsx:558-588`
- Modify: `src/components/LocationSearch.tsx:297-407`
- Modify: `src/index.css` near the existing location-search styles

**Interfaces:**

- Consumes: existing `runSearch(searchValue = value)` and `visibleError` state.
- Produces: an error-only button named `Try <label> search again` that retries the current value through `runSearch`.

- [ ] **Step 1: Write the failing recovery test**

Render automatic destination search with a client that rejects once with `GeocodingClientError('network', ...)` and then returns a literal suggestion. Type a query, advance the 700 ms debounce, assert the alert and retry button appear, activate retry, then assert the suggestion list appears and the retry button disappears.

- [ ] **Step 2: Verify the existing no-Search contract in the same state**

Assert that the automatic component does not expose a button named `Search destination`; this protects the user's no-Search-button requirement while allowing error recovery.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/components/LocationSearch.test.tsx
```

Expected: failure because the error-only retry action does not exist.

- [ ] **Step 4: Implement the minimal retry action**

When `visibleError` is present, render the existing alert plus:

```tsx
<button
  className="button button--secondary location-search__retry"
  type="button"
  aria-label={`Try ${readableLabel(label)} search again`}
  onClick={() => void runSearch()}
  disabled={visibleLoading}
>
  Try again
</button>
```

Add only scoped spacing/width styles needed for the new error action.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same focused Vitest command and require zero failures or warnings.

### Task 3: iPhone WebKit coverage and integrated QA

**Files:**

- Modify: `playwright.config.ts:19-28`
- Modify: `e2e/app.spec.ts` only if a mobile popup non-overlap assertion is not already covered by the component contract and rendered Browser verification.

**Interfaces:**

- Consumes: Playwright's built-in `devices['iPhone 13']` profile and existing E2E suite.
- Produces: a `mobile-webkit` project that runs the application suite using WebKit with an iPhone viewport and input model.

- [ ] **Step 1: Add the WebKit project**

Append:

```ts
{
  name: 'mobile-webkit',
  use: { ...devices['iPhone 13'] },
}
```

No package change is required because `@playwright/test` is already installed.

- [ ] **Step 2: Verify the project is discoverable**

Run:

```bash
npx playwright test --list --project=mobile-webkit
```

Expected: the existing E2E cases are listed for `mobile-webkit`.

- [ ] **Step 3: Run the scoped WebKit suite**

Run:

```bash
npm run test:e2e -- --project=mobile-webkit
```

If the WebKit runtime is missing, install only Playwright WebKit, then rerun. Do not change npm dependencies.

- [ ] **Step 4: Run integrated static and unit verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

- [ ] **Step 5: Validate the rendered target flow in the in-app Browser**

The flow under test is: load BRouter on a mobile viewport -> enter origin and destination -> show the candidate map -> open a station marker -> popup content and the zoom control remain separate -> trigger a controlled address-search failure -> Try again reruns the unchanged query.

Capture final screenshots in `/tmp`, inspect them, check the page identity, meaningful DOM, absence of framework overlay, console warnings/errors, and observed interaction state.
