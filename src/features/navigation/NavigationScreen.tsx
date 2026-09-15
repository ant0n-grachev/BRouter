import { lazy, Suspense, useEffect, useMemo, useReducer, useRef } from 'react';
import { isStationSnapshotStale } from '../../lib/gbfs';
import { haversineKm } from '../../lib/distance';
import type { StationSnapshot } from '../../types';
import { BCYCLE_APP_URL } from './bcycleApp';
import {
  applyStationChange,
  findStationChange,
  getAvailableJourneyStages,
  getJourneyLeg,
  setJourneyStage,
  type Journey,
  type NavigationStage,
  type RerouteMode,
} from './journey';
import { writeRerouteMode } from './journeyStorage';
import NavigationIcon, { type NavigationIconName } from './NavigationIcon';
import { isDisplayableFix, isNearTarget, isUsableFix } from './navigationLocation';
import { getNavigationStations } from './navigationStations';
import { useNavigationLocation } from './useNavigationLocation';
import { useNavigationHeading } from './useNavigationHeading';
import { useRoutedNavigation } from './useRoutedNavigation';
import { useScreenAwake } from './useScreenAwake';
import './navigation.css';

const NavigationMap = lazy(() => import('./NavigationMap'));
const titles = {
  pickup: 'Walk to pickup',
  ride: 'Ride to drop-off',
  destination: 'Walk to destination',
  complete: 'You’ve arrived',
};
const shortTitles = {
  pickup: 'To bike',
  ride: 'Ride',
  destination: 'Final walk',
  complete: 'Finished',
};

export interface NavigationScreenProps {
  journey: Journey;
  updateJourney: (transition: (current: Journey) => Journey) => void;
  onExit: () => void;
  snapshot: StationSnapshot | null;
  stationError: string | null;
  online: boolean;
}

function distanceLabel(meters: number): string {
  return meters < 160
    ? `${Math.max(0, Math.round((meters * 3.28084) / 10) * 10)} ft`
    : `${(meters / 1609.344).toFixed(1)} mi`;
}

function turnIcon(instruction: string): NavigationIconName {
  const action = instruction.toLowerCase().split(/\bonto\b/)[0];
  if (/u-turn|uturn/.test(action)) return 'uturn';
  if (/roundabout/.test(action)) return 'roundabout';
  if (/^(turn|keep|bear)\b.*\bleft\b/.test(action)) return 'left';
  if (/^(turn|keep|bear)\b.*\bright\b/.test(action)) return 'right';
  if (/^you.*arriv|^arrive/.test(action)) return 'flag';
  return 'straight';
}

export default function NavigationScreen({
  journey,
  updateJourney,
  onExit,
  snapshot,
  stationError,
  online,
}: NavigationScreenProps) {
  const [now, tick] = useReducer(() => Date.now(), 0, Date.now);
  const [dismissedChange, setDismissedChange] = useReducer(
    (_previous: string | null, next: string | null) => next,
    null,
  );
  const [notice, setNotice] = useReducer(
    (_previous: string | null, next: string | null) => next,
    null,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const active = journey.stage !== 'complete';
  const liveNavigation = journey.locationMode === 'device';
  const locationEnabled = active && liveNavigation;
  const location = useNavigationLocation(locationEnabled);
  const fix = locationEnabled && isUsableFix(location.fix, now) ? location.fix : null;
  const mapFix = locationEnabled && isDisplayableFix(location.fix, now) ? location.fix : null;
  const compass = useNavigationHeading(locationEnabled);
  useScreenAwake(locationEnabled);

  useEffect(() => {
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [journey.stage]);

  const leg = getJourneyLeg(journey);
  const stages = getAvailableJourneyStages(journey);
  const selectedStation =
    journey.stage === 'pickup' ? journey.pickup : journey.stage === 'ride' ? journey.dropoff : null;
  const liveStation = snapshot?.stations.find(
    (station) => station.station_id === selectedStation?.station_id,
  );
  const dataFresh = Boolean(
    snapshot &&
    !snapshot.isStale &&
    !isStationSnapshotStale(snapshot, now) &&
    !stationError &&
    online,
  );
  const change = useMemo(
    () => findStationChange(journey, dataFresh ? snapshot : null, fix, now),
    [journey, dataFresh, snapshot, fix, now],
  );
  const changeKey = change
    ? `${journey.stage}:${change.kind}:${change.previous.station_id}:${change.replacement?.station_id ?? 'none'}`
    : null;
  useEffect(() => {
    if (dataFresh && dismissedChange && dismissedChange !== changeKey) setDismissedChange(null);
  }, [dataFresh, dismissedChange, changeKey]);
  const replaceAutomatically =
    journey.rerouteMode === 'automatic' && change?.replacement !== null && change !== null;
  const routed = useRoutedNavigation(leg, fix, online, active && !replaceAutomatically);

  useEffect(() => {
    if (!replaceAutomatically || !change?.replacement) return;
    const replacementName = change.replacement.name;
    updateJourney((current) => {
      const latest = findStationChange(current, snapshot, fix);
      return latest?.replacement ? applyStationChange(current, latest) : current;
    });
    setNotice(`${change.kind === 'pickup' ? 'Pickup' : 'Drop-off'} changed to ${replacementName}.`);
  }, [replaceAutomatically, change, snapshot, fix, updateJourney]);

  const nearTarget = locationEnabled && isNearTarget(location.fix, leg.to, now);
  const atTarget = Boolean(fix && haversineKm(fix, leg.to) * 1000 + fix.accuracy <= 20);
  const unresolvedStation = Boolean(
    change &&
    dismissedChange !== changeKey &&
    ((journey.stage === 'pickup' && change.kind === 'pickup') ||
      (journey.stage === 'ride' && change.kind === 'dropoff')),
  );
  const mapStations = useMemo(() => {
    const selected = [journey.pickup, ...(journey.dropoff ? [journey.dropoff] : [])];
    return getNavigationStations(selected, snapshot, change?.alternatives);
  }, [journey.pickup, journey.dropoff, snapshot, change]);

  function changeMode(mode: RerouteMode) {
    writeRerouteMode(mode);
    updateJourney((current) => ({ ...current, rerouteMode: mode, updatedAt: Date.now() }));
    setDismissedChange(null);
  }
  function selectStage(stage: NavigationStage) {
    updateJourney((current) => setJourneyStage(current, stage));
    setDismissedChange(null);
    setNotice(null);
  }
  function acceptStation(stationId: string) {
    updateJourney((current) => {
      const latest = findStationChange(current, dataFresh ? snapshot : null, fix);
      const replacement = latest?.alternatives.find((station) => station.station_id === stationId);
      return latest && replacement
        ? applyStationChange(current, { ...latest, replacement })
        : current;
    });
    setDismissedChange(null);
  }

  const progress = routed.progress;
  const arrivalTime = progress
    ? new Date(now + progress.remainingDurationSeconds * 1000).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const instruction = !active
    ? 'Your trip is complete.'
    : atTarget
      ? `You’re near ${leg.toDescription}.`
      : routed.loading
        ? 'Finding your route…'
        : !liveNavigation
          ? titles[journey.stage]
          : (progress?.nextInstruction?.text ??
            (routed.error ? 'Directions unavailable' : 'Ready when you are'));
  const turnDistance =
    !active || atTarget
      ? 'You’ve arrived'
      : progress
        ? progress.distanceToInstructionMeters < 10
          ? 'Now'
          : distanceLabel(progress.distanceToInstructionMeters)
        : titles[journey.stage];

  return (
    <main className="navigation-screen" aria-label="Trip navigation">
      <h1 className="visually-hidden" ref={heading} tabIndex={-1}>
        {titles[journey.stage]}
      </h1>
      <Suspense
        fallback={
          <div className="navigation-map navigation-map--loading" role="status">
            Loading navigation map…
          </div>
        }
      >
        <NavigationMap
          key={`${journey.stage}:${leg.to.lat}:${leg.to.lon}`}
          route={routed.route}
          fix={mapFix}
          heading={compass.heading}
          active={active}
          locationEnabled={locationEnabled}
          onFollow={() => {
            if (!locationEnabled) return;
            compass.enableCompass();
            if (!mapFix) location.retry();
          }}
          target={leg.to}
          stations={mapStations.stations}
          missingStationIds={mapStations.missingStationIds}
          targetStationId={selectedStation?.station_id ?? null}
        />
      </Suspense>

      <header className="navigation-top">
        <section
          className="navigation-turn-banner"
          aria-label={liveNavigation ? 'Next direction' : 'Route overview'}
        >
          <div className="navigation-turn-icon">
            <NavigationIcon
              name={
                atTarget || !active
                  ? 'flag'
                  : !liveNavigation
                    ? journey.stage === 'ride'
                      ? 'bike'
                      : 'walk'
                    : turnIcon(instruction)
              }
            />
          </div>
          <div className="navigation-turn-copy">
            {liveNavigation ? <p className="navigation-turn-distance">{turnDistance}</p> : null}
            <p className="navigation-turn-instruction">{instruction}</p>
          </div>
        </section>
        <div className="navigation-top__tools">
          <p className="navigation-target" data-testid="navigation-target">
            <NavigationIcon name="pin" />
            <span>{leg.toDescription}</span>
          </p>
          <details className="navigation-settings">
            <summary aria-label="Navigation options">
              <NavigationIcon name="options" />
              <span>Options</span>
            </summary>
            <div className="navigation-settings__panel">
              <fieldset>
                <legend>If a station becomes unavailable</legend>
                <label>
                  <input
                    type="radio"
                    name="reroute-mode"
                    checked={journey.rerouteMode === 'ask'}
                    onChange={() => changeMode('ask')}
                  />
                  Ask me first
                </label>
                <label>
                  <input
                    type="radio"
                    name="reroute-mode"
                    checked={journey.rerouteMode === 'automatic'}
                    onChange={() => changeMode('automatic')}
                  />
                  Change route automatically
                </label>
              </fieldset>
            </div>
          </details>
        </div>
      </header>

      <section className="navigation-bottom" aria-label="Trip controls">
        <div className="navigation-alerts" aria-live="polite">
          {routed.error && active ? (
            <div className="navigation-warning">
              <p>{routed.error}</p>
              <button
                type="button"
                className="navigation-text-button"
                disabled={!online || routed.loading}
                onClick={routed.retry}
              >
                Retry directions
              </button>
            </div>
          ) : null}
          {change && !replaceAutomatically ? (
            <div className="navigation-warning" role="status">
              <p>
                <strong>{change.previous.name}</strong>{' '}
                {change.reason === 'no-bikes'
                  ? 'has no bikes available.'
                  : change.reason === 'no-docks'
                    ? 'has no docks available.'
                    : 'is unavailable.'}
              </p>
              {!change.replacement ? (
                <p>
                  No alternative {change.kind === 'pickup' ? 'pickup' : 'drop-off'} station is
                  available nearby. We’ll keep checking.
                </p>
              ) : null}
              {dismissedChange === changeKey ? (
                <button
                  type="button"
                  className="navigation-text-button"
                  onClick={() => setDismissedChange(null)}
                >
                  Review alternatives
                </button>
              ) : (
                <>
                  {change.replacement ? (
                    <div className="navigation-alternatives">
                      {change.alternatives.map((station) => (
                        <button
                          type="button"
                          className="button button--primary"
                          key={station.station_id}
                          onClick={() => acceptStation(station.station_id)}
                        >
                          Use {station.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="navigation-text-button"
                    onClick={() => setDismissedChange(changeKey)}
                  >
                    Keep current station
                  </button>
                </>
              )}
            </div>
          ) : null}
          {notice ? (
            <p className="navigation-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="navigation-trip-summary">
          <div>
            <p className="navigation-time">
              {!active || atTarget ? (
                'Arrived'
              ) : progress ? (
                <>
                  {Math.max(1, Math.ceil(progress.remainingDurationSeconds / 60))}
                  <span> min</span>
                </>
              ) : (
                '— min'
              )}
            </p>
            <p className="navigation-eta">
              {progress && active ? (
                <>
                  {distanceLabel(progress.remainingDistanceMeters)}
                  {liveNavigation ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {arrivalTime}
                    </>
                  ) : null}
                </>
              ) : (
                titles[journey.stage]
              )}
            </p>
          </div>
          <button
            type="button"
            className="navigation-exit"
            onClick={onExit}
            aria-label="End navigation"
          >
            <NavigationIcon name="close" />
            <span>Exit</span>
          </button>
        </div>

        {stages.length > 1 ? (
          <nav className="navigation-stages" aria-label="Choose navigation leg">
            {stages.map((stage) => (
              <button
                key={stage}
                type="button"
                aria-label={titles[stage]}
                aria-pressed={journey.stage === stage}
                onClick={() => selectStage(stage)}
              >
                <NavigationIcon name={stage === 'ride' ? 'bike' : 'walk'} />
                <span>{shortTitles[stage]}</span>
              </button>
            ))}
          </nav>
        ) : null}

        {selectedStation && (liveStation || dataFresh) ? (
          <div className="navigation-availability">
            {liveStation ? (
              <span>
                <strong>{liveStation.num_bikes_available}</strong> bikes ·{' '}
                <strong>{liveStation.num_docks_available}</strong> docks
              </span>
            ) : (
              <span>Station unavailable</span>
            )}
          </div>
        ) : null}
        {nearTarget && selectedStation && !unresolvedStation ? (
          <a className="navigation-bcycle" href={BCYCLE_APP_URL}>
            Open BCycle app <span aria-hidden="true">↗</span>
          </a>
        ) : null}
        {nearTarget && active && (journey.stage === 'destination' || stages.length === 1) ? (
          <button
            type="button"
            className="navigation-finish"
            onClick={() => (stages.length === 1 ? onExit() : selectStage('complete'))}
          >
            Finish trip
          </button>
        ) : null}
        {!active ? (
          <button type="button" className="navigation-finish" onClick={onExit}>
            Back to planner
          </button>
        ) : null}

        <p className="navigation-attribution">
          <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer">
            openrouteservice
          </a>{' '}
          · ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap contributors
          </a>
        </p>
      </section>
    </main>
  );
}
