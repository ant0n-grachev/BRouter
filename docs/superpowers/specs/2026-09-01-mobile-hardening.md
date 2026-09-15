# Mobile Hardening Specification

## Approved scope

1. Prevent the mobile Leaflet zoom controls from covering station popup content.
2. Explain that a user can tap a candidate marker to choose a pickup or drop-off station.
3. Show an error-only retry action after automatic address search fails. Do not restore a normal Search button.
4. Add an iPhone-sized WebKit Playwright project and verify the relevant mobile flow there.

## Constraints

- Preserve automatic debounced address search and the existing service-area restriction.
- Preserve the current station-ranking, selection, itinerary, manifest, service-worker, and offline contracts.
- Do not reorder the trip planner and Service Area Map in this pass.
- Do not add production dependencies.
- Do not deploy, push, or commit. The working tree already contains user-approved uncommitted work.
- Use test-first red/green cycles for behavior changes and keep temporary browser evidence outside the repository.

## Acceptance criteria

- A station popup and the Leaflet zoom control do not overlap in the mobile candidate-map flow.
- Planned-trip map help explicitly tells users that tapping a candidate marker opens selection actions.
- A failed address lookup displays a visible Try again action; activating it retries the unchanged query and clears the error after success.
- No normal Search button is shown while automatic search mode is active.
- Playwright includes a Mobile Safari-compatible WebKit/iPhone project and the scoped WebKit run passes.
