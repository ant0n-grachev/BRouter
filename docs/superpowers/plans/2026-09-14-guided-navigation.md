# BRouter navigation implementation

This plan reflects the user’s September 14 revision to the original guided-navigation flow.

- [x] Route every planner action through BRouter, including origin-only pickup navigation. Full trips begin at pickup, with leg selection inside navigation.
- [x] Remove external map links, URL-building helpers, product copy, and metadata references.
- [x] Support pickup-only journeys without fabricated endpoints and preserve validated local storage.
- [x] Remove all automatic leg transitions and obsolete handoff handling. Add direct manual stage selection and ignore legacy handoff data.
- [x] Build the navigator map, turn banner, arrival summary, visible leg controls, and concise options panel. Remove the complete directions list.
- [x] Show automatic station availability with no navigation refresh button. Preserve ask/automatic station replacement modes.
- [x] Add behavioral tests for the revised flow and update existing planner/browser assertions.
- [x] Complete unit/browser regression runs, independent review, and desktop/mobile visual verification.

## Initial navigation verification

- 247 unit tests passed across 29 files.
- Type checking, lint, production build, formatting, and diff checks passed.
- 57 existing app browser checks passed; the revised navigation checks passed 30/30 across desktop Chromium, mobile Chromium, and mobile WebKit after correcting test selectors and panel interactions.
- Independent review confirmed the availability refresh, missing-station markers, camera reset, and manual stage behavior fixes.
- Desktop and mobile screenshots showed the blue route and accessible controls without clipping. Browser fixtures intentionally block external map tiles; these captures verify route and interface rendering.

## Subsequent planner cleanup

Pickup-only navigation hides the single-leg switcher. The planner itinerary heading, estimate note, leg cards, and per-leg buttons are removed; the main **Go to navigation** action remains. The final removal passed 9 affected unit tests, 9 focused browser checks across all three browser projects, type checking, build, scoped lint, formatting, and diff checks.

## Silent navigation and compass follow-up

Location-waiting/error banners and availability-refresh text are removed. Availability refreshes in the background while retaining the previous counts; stale counts are labeled **Last known**. Navigation opens in a manual overview when permission is ungranted, with explicit location access available through the follow button. Fresh approximate positions display with an accuracy circle; only accurate fixes drive route/proximity actions. Follow centers and tracks the rider, the compass supplies a facing arrow/cone with GPS-course fallback, dragging pauses following, and **Show route** restores the overview.

Final validation: 259 unit tests across 30 files; 42 navigation browser checks across desktop Chromium, mobile Chromium, and mobile WebKit; 9 repeated compass/follow stability checks; type checking, full lint, production build, formatting, and diff checks passed. Desktop/mobile screenshots were inspected after the follow camera settled. Sensor fixtures isolate native browser events and account for screen orientation. Physical-phone sensor and BCycle-launch checks remain outside automated coverage. No deployment was performed.

## Routing configuration

The user-provided routing key is stored in ignored, owner-readable local configuration. Live walking and cycling endpoint checks succeeded, and the key was absent from built browser assets. No key is recorded in this document.

No deployment has been performed. Native BCycle launch still requires a physical phone.
