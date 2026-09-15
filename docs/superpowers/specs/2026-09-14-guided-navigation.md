# BRouter navigation

## Current requested experience

All planner route actions open BRouter navigation. Entering only a starting location and selecting a pickup station is enough to start a pickup-only walk. A complete plan starts at pickup using **Go to navigation**. The planner has no itinerary cards, estimate note, or individual-leg navigation buttons.

The navigator fills the app viewport with a route map. An entered starting address opens a route-only view with the selected leg, distance, and duration. Choosing **My location** enables the next-turn banner, live position, and arrival-time summary. Leg controls are visible only for journeys with multiple legs. Riders can select walk to pickup, ride to drop-off, or walk to destination in any order whenever those endpoints exist. There is no automatic leg change, including on proximity, app switching, returning from BCycle, or reload. The selected leg and location mode are saved locally.

The nearby **Open BCycle app** link only opens BCycle. It does not unlock, purchase, return, confirm a rental action, or arm a later stage transition. The long directions list is removed. A prominent instruction remains visible while approaching the station, even when the nearby app-launch button appears.

## Station availability and routes

Station availability updates silently every fifteen seconds while visible and refreshes on return. Navigation has no manual availability-refresh button, updating text, freshness indicator, or app-store link. Previous counts remain visible during background requests and transient failures, without refresh warnings. **Ask me first** (default) and **Change route automatically** remain settings for unavailable stations; they never control walking/cycling stage selection. Only fresh successful data can replace a station. Pickup-only journeys have no invented destination or drop-off.

The planner leads with the trip inputs and navigation action, followed by the optional station map. Routine loading copy, refresh timestamps, successful GPS coordinates, redundant introductions, and duplicated low-availability warnings are hidden or removed. About and install details stay collapsed. Short station labels and actionable error messages keep choices understandable; map attribution and accessible control descriptions remain available.

Walking and cycling routes come from openrouteservice through the server endpoint. The key remains in server configuration. Failed routes do not fall back to invented straight-line guidance. GPS fixes must be recent and sufficiently accurate for proximity actions. Location tracking and screen wake lock stop while hidden or inactive.

Navigation shows no location-waiting or location-error banners. A manual starting address never enables GPS, compass, wake lock, proximity actions, or follow controls, even with existing browser permission. Its route remains anchored to the entered points. The saved location mode survives reload; legacy records default to manual. In device-origin journeys, fresh approximate positions display with an accuracy circle, while route/proximity decisions keep the stricter accuracy requirement. The map starts with a route overview. The location button enables zoomed following and requests compass permission when required. A compass-facing arrow and cone fall back to GPS travel direction or a dot when no reliable direction exists. Dragging pauses following; **Show route** restores the overview. No leg changes automatically.

## Preservation and validation

Keep numerical bikes/docks markers, accessible controls, and visible map/routing attribution. Keep validated local journey persistence, stripping obsolete handoff fields from old records. Ending navigation clears the active journey.

Cover origin-only entry, selected pickup changes, direct and backward stage changes without GPS, BCycle-return immunity, legacy-record reload, automatic station refresh, manual/automatic rerouting, stale/error data, nearby instructions, pickup-only completion, mobile layout, and accessibility. Native BCycle launch still needs physical-phone verification. Work remains local; deployment is outside this request.
