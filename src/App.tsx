import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ServiceStatus from './components/ServiceStatus';
import StationMap from './components/StationMap';
import TripPlanner from './features/trip-planner/TripPlanner';
import { useTripPlanner } from './features/trip-planner/useTripPlanner';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useServiceAreaData } from './hooks/useServiceAreaData';
import { useStandaloneMode } from './hooks/useStandaloneMode';
import { computeStationCoverageHull } from './lib/coverage';
import type { TripPlan } from './lib/tripPlanner';
import type { LatLon, Station } from './types';
import { createJourney, createPickupJourney, type Journey } from './features/navigation/journey';
import { readJourney, readRerouteMode, writeJourney } from './features/navigation/journeyStorage';

const NavigationScreen = lazy(() => import('./features/navigation/NavigationScreen'));

export default function App() {
  const [journey, setJourney] = useState<Journey | null>(readJourney);
  const journeyRef = useRef(journey);
  useLayoutEffect(() => {
    journeyRef.current = journey;
  }, [journey]);
  const updateJourney = useCallback((transition: (current: Journey) => Journey) => {
    const current = journeyRef.current;
    if (!current) return;
    const next = transition(current);
    if (next === current) return;
    // Persist synchronously before an external app can suspend this document.
    journeyRef.current = next;
    writeJourney(next);
    setJourney(next);
  }, []);
  const storeNewJourney = useCallback((next: Journey) => {
    journeyRef.current = next;
    writeJourney(next);
    setJourney(next);
  }, []);
  const endNavigation = useCallback(() => {
    journeyRef.current = null;
    writeJourney(null);
    setJourney(null);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('.trip-results__start, .pickup-shortcut button')
        ?.focus(),
    );
  }, []);
  const [mapExpanded, setMapExpanded] = useState(false);
  const online = useOnlineStatus();
  const standalone = useStandaloneMode();
  const { data, availability, error, refresh, refreshing } = useServiceAreaData(
    journey ? 15_000 : 60_000,
  );
  const stations = useMemo(() => data?.stations ?? [], [data]);
  const planner = useTripPlanner(stations);
  const coverage = useMemo(() => computeStationCoverageHull(stations), [stations]);
  const startNavigation = useCallback(
    (plan: TripPlan) => {
      storeNewJourney(createJourney(plan, readRerouteMode(), Date.now(), planner.originMode));
    },
    [planner.originMode, storeNewJourney],
  );
  const startPickupNavigation = useCallback(
    (origin: LatLon, pickup: Station) => {
      storeNewJourney(
        createPickupJourney(origin, pickup, readRerouteMode(), Date.now(), planner.originMode),
      );
    },
    [planner.originMode, storeNewJourney],
  );

  return (
    <>
      {journey ? (
        <Suspense
          fallback={
            <div className="navigation-loading" role="status">
              Opening navigation…{' '}
              <button className="button button--secondary" type="button" onClick={endNavigation}>
                Back to planner
              </button>
            </div>
          }
        >
          <NavigationScreen
            journey={journey}
            updateJourney={updateJourney}
            onExit={endNavigation}
            snapshot={data?.snapshot ?? null}
            stationError={error}
            online={online}
          />
        </Suspense>
      ) : null}
      <div className="app-shell" hidden={journey !== null}>
        <main className="app-card">
          <header className="app-header">
            <div>
              <div className="app-title-row">
                <h1 className="app-title">
                  <span aria-hidden="true">🚲</span> Madison&apos;s BRouter
                </h1>
                <a
                  className="app-byline"
                  href="https://anton.grachev.us"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  by Anton
                </a>
              </div>
            </div>
          </header>

          {!online ? (
            <div className="offline-banner" role="status" aria-live="polite">
              You’re offline. Reconnect to search and see current availability.
            </div>
          ) : null}

          <TripPlanner
            controller={planner}
            onStartNavigation={startNavigation}
            onStartPickupNavigation={startPickupNavigation}
          />

          <ServiceStatus
            snapshot={data?.snapshot ?? null}
            availability={availability}
            error={error}
            refreshing={refreshing}
            mapAvailable={stations.length > 0}
            mapExpanded={mapExpanded}
            onRefresh={refresh}
            onToggleMap={() => setMapExpanded((expanded) => !expanded)}
          />

          {mapExpanded && data ? (
            <StationMap
              stations={stations}
              coverage={coverage}
              origin={planner.origin}
              destination={planner.destination}
              selectedPickupId={planner.selectedPickup?.station.station_id ?? null}
              selectedDropoffId={planner.selectedDropoff?.station.station_id ?? null}
              pickupCandidateIds={planner.pickupCandidates.map(
                (candidate) => candidate.station.station_id,
              )}
              dropoffCandidateIds={planner.dropoffCandidates.map(
                (candidate) => candidate.station.station_id,
              )}
              onSelectPickup={planner.selectPickup}
              onSelectDropoff={planner.selectDropoff}
            />
          ) : null}

          <footer className="app-footer">
            <details className="app-install">
              <summary>About BRouter</summary>
              <p className="app-install__instructions">
                Independent community tool using public data. Not affiliated with, endorsed by, or
                operated by Madison BCycle.
              </p>
            </details>
            {!standalone ? (
              <details className="app-install">
                <summary>Install app</summary>
                <div className="app-install__instructions">
                  <p>
                    <strong>iPhone/iPad:</strong> Open in Safari, tap Share, choose Add to Home
                    Screen, keep Open as Web App on, then tap Add.
                  </p>
                  <p>
                    <strong>Android:</strong> Open in Chrome, tap the three-dot menu, choose Install
                    app or Add to Home screen, then follow the prompts.
                  </p>
                </div>
              </details>
            ) : null}
          </footer>
        </main>
      </div>
    </>
  );
}
