import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { StationServiceArea } from '../lib/coverage';
import {
  createGeocodingClient,
  GeocodingClientError,
  parseCoordinateInput,
} from '../services/geocodingClient';
import type {
  GeocodeSuggestion,
  GeocodingClient,
  GeocodingSearchOutcome,
} from '../services/geocodingClient';

const defaultClient = createGeocodingClient();
const AUTOMATIC_SEARCH_DELAY_MS = 700;
const MIN_AUTOMATIC_QUERY_LENGTH = 3;

function defaultSearch(
  query: string,
  options?: { signal?: AbortSignal; serviceArea?: StationServiceArea },
): Promise<GeocodingSearchOutcome> {
  return defaultClient.search(query, options);
}

function readableLabel(label: string): string {
  return label.toLocaleLowerCase();
}

function stableHash(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function errorMessage(error: unknown): string {
  if (error instanceof GeocodingClientError) {
    switch (error.code) {
      case 'offline':
        return 'You are offline. Address search requires a connection.';
      case 'rate_limited':
        return 'Address search is temporarily rate-limited. Please wait and try again.';
      case 'network':
        return 'Address search could not be completed. Check your connection and try again.';
      case 'aborted':
        return '';
      case 'invalid_coordinates':
        return 'Coordinates must use latitude from -90 to 90 and longitude from -180 to 180.';
    }
  }
  return 'Address search could not be completed. Please try again.';
}

interface LocationSearchProps {
  label: string;
  onSelectionChange: (selection: GeocodeSuggestion | null) => void;
  search?: GeocodingClient['search'];
  searchAfterPause?: boolean;
  serviceArea?: StationServiceArea | null;
  value?: string;
  onValueChange?: (value: string) => void;
  onInputChange?: () => void;
  inputAction?: ReactNode;
}

export default function LocationSearch({
  label,
  onSelectionChange,
  search = defaultSearch,
  searchAfterPause = false,
  serviceArea,
  value: controlledValue,
  onValueChange,
  onInputChange,
  inputAction,
}: LocationSearchProps) {
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const hintId = `${generatedId}-hint`;
  const statusId = `${generatedId}-status`;
  const errorId = `${generatedId}-error`;
  const serviceAreaKey = serviceArea?.cacheKey ?? null;
  const requestSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const scheduledSearchRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [internalValue, setInternalValue] = useState('');
  const value = controlledValue ?? internalValue;
  function setValue(next: string): void {
    setInternalValue(next);
    onValueChange?.(next);
  }
  const [selection, setSelection] = useState<GeocodeSuggestion | null>(null);
  const [transientServiceAreaKey, setTransientServiceAreaKey] = useState(serviceAreaKey);
  const [results, setResults] = useState<readonly GeocodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const isCurrentSearchContext = transientServiceAreaKey === serviceAreaKey;
  const visibleResults = isCurrentSearchContext ? results : [];
  const visibleOpen = isCurrentSearchContext && open;
  const visibleLoading = isCurrentSearchContext && loading;
  const visibleEmpty = isCurrentSearchContext && empty;
  const visibleError = isCurrentSearchContext ? error : null;
  const visibleAnnouncement = isCurrentSearchContext ? announcement : '';

  useEffect(() => {
    if (scheduledSearchRef.current !== null) {
      globalThis.clearTimeout(scheduledSearchRef.current);
      scheduledSearchRef.current = null;
    }
    requestSequence.current += 1;
    controllerRef.current?.abort();
  }, [serviceAreaKey]);

  useEffect(
    () => () => {
      if (scheduledSearchRef.current !== null) {
        globalThis.clearTimeout(scheduledSearchRef.current);
      }
      requestSequence.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  function optionId(suggestion: GeocodeSuggestion): string {
    return `${generatedId}-option-${stableHash(`${suggestion.lat}:${suggestion.lon}:${suggestion.label}`)}`;
  }

  function choose(next: GeocodeSuggestion): void {
    setTransientServiceAreaKey(serviceAreaKey);
    setValue(next.label);
    setSelection(next);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setEmpty(false);
    setError(null);
    setAnnouncement('');
    onSelectionChange(next);
  }

  function handleChange(next: string): void {
    onInputChange?.();
    if (scheduledSearchRef.current !== null) {
      globalThis.clearTimeout(scheduledSearchRef.current);
      scheduledSearchRef.current = null;
    }
    controllerRef.current?.abort();
    requestSequence.current += 1;
    setTransientServiceAreaKey(serviceAreaKey);
    setValue(next);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setLoading(false);
    setEmpty(false);
    setError(null);
    setAnnouncement('');

    if (selection) {
      setSelection(null);
      onSelectionChange(null);
    }

    if (searchAfterPause && next.trim().length >= MIN_AUTOMATIC_QUERY_LENGTH) {
      scheduledSearchRef.current = globalThis.setTimeout(() => {
        scheduledSearchRef.current = null;
        void runSearch(next);
      }, AUTOMATIC_SEARCH_DELAY_MS);
    }
  }

  async function runSearch(searchValue = value): Promise<void> {
    const query = searchValue.trim();
    setTransientServiceAreaKey(serviceAreaKey);
    if (!query) {
      setError(`Enter an address or coordinates for ${readableLabel(label)}.`);
      setAnnouncement('');
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setEmpty(false);
    setError(null);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setAnnouncement(`Searching for ${readableLabel(label)}.`);

    try {
      const coordinate = parseCoordinateInput(query);
      if (searchAfterPause && !coordinate && !serviceArea) {
        setError('Live station data is required to search within the BCycle service area.');
        setAnnouncement(`${label} search is waiting for live station data.`);
        return;
      }

      const outcome = await search(query, {
        signal: controller.signal,
        serviceArea: serviceArea ?? undefined,
      });
      if (requestSequence.current !== requestId) return;

      if (outcome.kind === 'empty') {
        setEmpty(true);
        setAnnouncement(
          serviceArea
            ? 'No matching locations found within the current BCycle service area. Try a more specific address.'
            : 'No matching locations found. Try a more specific address.',
        );
        return;
      }

      if (coordinate) {
        choose(coordinate);
        return;
      }

      setResults(outcome.suggestions);
      setOpen(true);
      setAnnouncement(
        `${outcome.suggestions.length} ${outcome.suggestions.length === 1 ? 'location' : 'locations'} found. Use the arrow keys to review ${outcome.suggestions.length === 1 ? 'it' : 'them'}.`,
      );
    } catch (caught: unknown) {
      if (requestSequence.current !== requestId) return;
      const message = errorMessage(caught);
      if (message) {
        setError(message);
        setAnnouncement(message);
      }
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (scheduledSearchRef.current !== null) {
      globalThis.clearTimeout(scheduledSearchRef.current);
      scheduledSearchRef.current = null;
    }
    if (visibleLoading || visibleResults.length > 0) return;
    await runSearch();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && visibleOpen) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'Enter' && visibleOpen && visibleResults.length > 0) {
      event.preventDefault();
      const selectedIndex = activeIndex >= 0 ? activeIndex : 0;
      const selected = visibleResults[selectedIndex];
      if (selected) choose(selected);
      return;
    }

    if (visibleResults.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current >= visibleResults.length - 1 ? 0 : current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current <= 0 ? visibleResults.length - 1 : current - 1));
    }
  }

  function keepInputFocus(event: MouseEvent<HTMLElement>): void {
    event.preventDefault();
  }

  function clear(): void {
    if (scheduledSearchRef.current !== null) {
      globalThis.clearTimeout(scheduledSearchRef.current);
      scheduledSearchRef.current = null;
    }
    controllerRef.current?.abort();
    requestSequence.current += 1;
    setTransientServiceAreaKey(serviceAreaKey);
    setValue('');
    setSelection(null);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setLoading(false);
    setEmpty(false);
    setError(null);
    setAnnouncement('');
    onSelectionChange(null);
  }

  const activeResult = visibleOpen && activeIndex >= 0 ? visibleResults[activeIndex] : undefined;
  const describedBy = [hintId, statusId, visibleError ? errorId : null].filter(Boolean).join(' ');

  return (
    <form className="location-search" onSubmit={(event) => void handleSubmit(event)}>
      <label className="location-search__label" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={
          searchAfterPause && !inputAction
            ? 'location-search__controls location-search__controls--automatic'
            : 'location-search__controls'
        }
      >
        <div className="location-search__combobox">
          <input
            id={inputId}
            className="input location-search__input"
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(visibleResults.length > 0)}
            placeholder="Address or place"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visibleOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeResult ? optionId(activeResult) : undefined}
            aria-describedby={describedBy}
            autoComplete="off"
          />
          {value ? (
            <button
              className="location-search__clear"
              type="button"
              aria-label={`Clear ${readableLabel(label)}`}
              onMouseDown={keepInputFocus}
              onClick={clear}
            >
              ×
            </button>
          ) : null}
          {visibleOpen && visibleResults.length > 0 ? (
            <ul
              id={listboxId}
              className="location-search__list"
              role="listbox"
              aria-label={`${label} results`}
            >
              {visibleResults.map((result, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    id={optionId(result)}
                    className={
                      active
                        ? 'location-search__option location-search__option--active'
                        : 'location-search__option'
                    }
                    key={`${result.lat}:${result.lon}:${result.label}`}
                    role="option"
                    aria-selected={active}
                    onMouseDown={keepInputFocus}
                    onClick={() => choose(result)}
                  >
                    {result.label}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {inputAction}
        {searchAfterPause ? null : (
          <button
            className="button button--primary location-search__submit"
            type="submit"
            disabled={visibleLoading}
            aria-label={`Search ${readableLabel(label)}`}
          >
            {visibleLoading ? 'Searching…' : 'Search'}
            <span className="visually-hidden"> {readableLabel(label)}</span>
          </button>
        )}
      </div>
      <p id={hintId} className="visually-hidden">
        {searchAfterPause
          ? 'Type at least 3 characters.'
          : 'Search runs only when you press Enter or choose Search.'}
      </p>
      <div
        id={statusId}
        className={visibleLoading ? 'field-status' : 'visually-hidden'}
        aria-live="polite"
        role="status"
      >
        {visibleLoading ? 'Searching…' : visibleAnnouncement}
      </div>
      {visibleEmpty ? (
        <p className="location-search__empty">
          {serviceArea
            ? 'No matching locations found within the current BCycle service area. Try a more specific address.'
            : 'No matching locations found. Try a more specific address.'}
        </p>
      ) : null}
      {visibleError ? (
        <>
          <p id={errorId} className="field-error" role="alert">
            {visibleError}
          </p>
          <button
            className="button button--secondary location-search__retry"
            type="button"
            aria-label={`Try ${readableLabel(label)} search again`}
            onClick={() => void runSearch()}
            disabled={visibleLoading}
          >
            Try again
          </button>
        </>
      ) : null}
    </form>
  );
}
