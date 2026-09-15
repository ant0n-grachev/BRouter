import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { GeocodingClientError } from '../services/geocodingClient';
import { useState } from 'react';
import type { GeocodingClient, GeocodingSearchOutcome } from '../services/geocodingClient';
import LocationSearch from './LocationSearch';

const suggestions = [
  { lat: 43.0731, lon: -89.4012, label: 'Capitol Square, Madison, Wisconsin' },
  { lat: 43.0753, lon: -89.4034, label: 'State Street, Madison, Wisconsin' },
] as const;

const serviceArea = {
  bounds: { west: -89.43, north: 43.1, east: -89.36, south: 43.05 },
  points: [{ lat: 43.0731, lon: -89.4012 }],
  cacheKey: 'location-search-test',
} as const;

const refreshedServiceArea = {
  bounds: { west: -89.5, north: 43.14, east: -89.31, south: 43.01 },
  points: [{ lat: 43.08, lon: -89.42 }],
  cacheKey: 'location-search-refreshed-test',
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderSearch(search = vi.fn().mockResolvedValue({ kind: 'results', suggestions })) {
  const onSelectionChange = vi.fn();
  const user = userEvent.setup();

  render(
    <LocationSearch label="Destination" search={search} onSelectionChange={onSelectionChange} />,
  );

  return {
    input: screen.getByRole('combobox', { name: 'Destination' }),
    search,
    onSelectionChange,
    user,
  };
}

describe('LocationSearch', () => {
  it('supports a device-origin display value without losing the first typed edit', () => {
    const onInputChange = vi.fn();
    function ControlledSearch() {
      const [value, setValue] = useState('My location');
      return (
        <LocationSearch
          label="Starting location"
          value={value}
          onValueChange={setValue}
          onInputChange={onInputChange}
          onSelectionChange={vi.fn()}
        />
      );
    }
    render(<ControlledSearch />);
    const input = screen.getByRole('combobox', { name: 'Starting location' });
    expect(input).toHaveValue('My location');
    fireEvent.change(input, { target: { value: 'Entered address' } });
    expect(input).toHaveValue('Entered address');
    expect(onInputChange).toHaveBeenCalledOnce();
  });

  it('aborts pending autocomplete and ignores its response when the planner resets the field', async () => {
    const request = deferred<GeocodingSearchOutcome>();
    const search = vi.fn<GeocodingClient['search']>().mockReturnValue(request.promise);
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <LocationSearch
        key={0}
        label="Starting location"
        search={search}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Starting location' }), {
      target: { value: 'State Street' },
    });
    fireEvent.submit(screen.getByRole('combobox', { name: 'Starting location' }).closest('form')!);
    const signal = search.mock.calls[0]?.[1]?.signal as AbortSignal;

    rerender(
      <LocationSearch
        key={1}
        label="Starting location"
        search={search}
        onSelectionChange={onSelectionChange}
      />,
    );
    expect(signal.aborted).toBe(true);
    await act(async () => {
      request.resolve({ kind: 'results', suggestions });
      await request.promise;
    });
    expect(screen.getByRole('combobox', { name: 'Starting location' })).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('automatically searches after a 700 ms pause while the field stays focused', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    const onSelectionChange = vi.fn();
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={onSelectionChange}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    input.focus();
    fireEvent.change(input, { target: { value: 'State Street' } });
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Search destination' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();

    await act(async () => vi.advanceTimersByTimeAsync(699));
    expect(search).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(screen.getByRole('listbox', { name: 'Destination results' })).toBeVisible();
    expect(search).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
  });

  it('offers an error-only retry after an automatic search fails', async () => {
    vi.useFakeTimers();
    const search = vi
      .fn()
      .mockRejectedValueOnce(new GeocodingClientError('network', 'temporary failure'))
      .mockResolvedValueOnce({ kind: 'results', suggestions: [suggestions[0]] });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Address search could not be completed. Check your connection and try again.',
    );
    expect(screen.getByRole('button', { name: 'Try destination search again' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Search destination' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try destination search again' }));
      await Promise.resolve();
    });

    expect(screen.getByRole('listbox', { name: 'Destination results' })).toBeVisible();
    expect(search).toHaveBeenNthCalledWith(
      1,
      'State Street',
      expect.objectContaining({ serviceArea }),
    );
    expect(search).toHaveBeenNthCalledWith(
      2,
      'State Street',
      expect.objectContaining({ serviceArea }),
    );
    const calls = search.mock.calls as Array<[string, { serviceArea?: typeof serviceArea }]>;
    expect(calls[0]?.[1]?.serviceArea).toBe(serviceArea);
    expect(calls[1]?.[1]?.serviceArea).toBe(serviceArea);
    expect(input).toHaveValue('State Street');
    expect(
      screen.queryByRole('button', { name: 'Try destination search again' }),
    ).not.toBeInTheDocument();
  });

  it('waits for at least three characters before automatic search', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Destination' }), {
      target: { value: 'St' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('restarts the automatic-search pause when typing continues', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State' } });
    await act(async () => vi.advanceTimersByTimeAsync(600));
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(100));

    expect(search).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('State Street', expect.objectContaining({ serviceArea }));
  });

  it('does not trigger an extra search when the field loses focus', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    fireEvent.blur(input);

    expect(search).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('identifies the starting-location field while automatic search waits for station data', async () => {
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    const user = userEvent.setup();
    render(
      <LocationSearch
        label="Starting location"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={null}
      />,
    );

    await user.type(screen.getByRole('combobox', { name: 'Starting location' }), 'State Street');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Live station data is required to search within the BCycle service area.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Starting location search is waiting for live station data.',
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('clears an automatic destination without starting a search', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear destination' }));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(input).toHaveValue('');
    expect(search).not.toHaveBeenCalled();
  });

  it('ignores an automatic result after the destination text is edited', async () => {
    vi.useFakeTimers();
    const pending = deferred<GeocodingSearchOutcome>();
    const search = vi.fn().mockReturnValue(pending.promise);
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(search).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: 'State Street updated' } });
    await act(async () => {
      pending.resolve({ kind: 'results', suggestions });
      await pending.promise;
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('State Street updated');
  });

  it('invalidates an automatic search when the service area changes', async () => {
    vi.useFakeTimers();
    const pending = deferred<GeocodingSearchOutcome>();
    let requestSignal: AbortSignal | undefined;
    const search = vi.fn((_query: string, options?: { signal?: AbortSignal }) => {
      requestSignal = options?.signal;
      return pending.promise;
    });
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={onSelectionChange}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(search).toHaveBeenCalledTimes(1);

    rerender(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={onSelectionChange}
        searchAfterPause
        serviceArea={refreshedServiceArea}
      />,
    );
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve({ kind: 'results', suggestions });
      await pending.promise;
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('cancels a pending automatic search when the service area changes', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={onSelectionChange}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Destination' }), {
      target: { value: 'State Street' },
    });
    rerender(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={onSelectionChange}
        searchAfterPause
        serviceArea={refreshedServiceArea}
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(search).not.toHaveBeenCalled();
  });

  it('cancels a pending automatic search when unmounted', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    const { unmount } = render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Destination' }), {
      target: { value: 'State Street' },
    });
    unmount();
    await vi.advanceTimersByTimeAsync(700);

    expect(search).not.toHaveBeenCalled();
  });

  it('does not search while the user is typing and searches once from the button', async () => {
    const { input, search, user } = renderSearch();

    await user.type(input, 'State Street');
    expect(search).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Search destination' }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  });

  it('submits one search when Enter is pressed', async () => {
    const { input, search, user } = renderSearch();

    await user.type(input, 'Capitol Square{Enter}');

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  });

  it('cancels the pending automatic search when Enter searches immediately', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'Capitol Square' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('does not restart the same automatic search when Enter is pressed while it is loading', async () => {
    vi.useFakeTimers();
    const pending = deferred<GeocodingSearchOutcome>();
    let requestSignal: AbortSignal | undefined;
    const search = vi.fn((_query: string, options?: { signal?: AbortSignal }) => {
      requestSignal = options?.signal;
      return pending.promise;
    });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(search).toHaveBeenCalledTimes(1);

    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(search).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);

    await act(async () => {
      pending.resolve({ kind: 'results', suggestions });
      await pending.promise;
    });
  });

  it('does not repeat the same automatic search when its results are already visible', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions });
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    fireEvent.change(input, { target: { value: 'State Street' } });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByRole('listbox', { name: 'Destination results' })).toBeVisible();

    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('listbox', { name: 'Destination results' })).toBeVisible();
  });

  it('resolves submitted coordinates immediately without requiring result selection', async () => {
    const coordinate = { lat: 43.0731, lon: -89.4012, label: '43.07310, -89.40120' };
    const search = vi.fn().mockResolvedValue({ kind: 'results', suggestions: [coordinate] });
    const { input, onSelectionChange, user } = renderSearch(search);

    await user.type(input, '43.0731, -89.4012{Enter}');

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(coordinate));
    expect(input).toHaveValue(coordinate.label);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('exposes the combobox relationship and supports arrow navigation and selection', async () => {
    const { input, onSelectionChange, user } = renderSearch();
    await user.type(input, 'Madison');
    await user.keyboard('{Enter}');

    const listbox = await screen.findByRole('listbox', { name: 'Destination results' });
    const options = screen.getAllByRole('option');

    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(screen.getByText('2 locations found. Use the arrow keys to review them.')).toBeVisible();

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(onSelectionChange).toHaveBeenLastCalledWith(suggestions[0]);
    expect(input).toHaveValue(suggestions[0].label);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(`Selected ${suggestions[0].label}.`)).not.toBeInTheDocument();
  });

  it('selects the first visible result when Enter is pressed without an active result', async () => {
    const { input, onSelectionChange, search, user } = renderSearch();
    await user.type(input, 'Madison{Enter}');
    await screen.findByRole('listbox', { name: 'Destination results' });

    await user.keyboard('{Enter}');

    expect(onSelectionChange).toHaveBeenLastCalledWith(suggestions[0]);
    expect(input).toHaveValue(suggestions[0].label);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('closes results with Escape without moving focus', async () => {
    const { input, user } = renderSearch();
    await user.type(input, 'Madison{Enter}');
    await screen.findByRole('listbox');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('supports pointer selection and invalidates it when the selected text is edited', async () => {
    const { input, onSelectionChange, user } = renderSearch();
    await user.type(input, 'Madison{Enter}');

    await user.click(await screen.findByRole('option', { name: suggestions[1].label }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(suggestions[1]);

    await user.type(input, ' edited');
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('shows a clear empty state after an explicit search', async () => {
    const search = vi.fn().mockResolvedValue({ kind: 'empty' });
    const { input, user } = renderSearch(search);

    await user.type(input, 'No such place{Enter}');

    expect(
      await screen.findByText('No matching locations found. Try a more specific address.', {
        selector: 'p',
      }),
    ).toBeVisible();
  });

  it('shows visible progress while an automatic search is pending', async () => {
    vi.useFakeTimers();
    const pending = deferred<GeocodingSearchOutcome>();
    const search = vi.fn().mockReturnValue(pending.promise);
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        searchAfterPause
        serviceArea={serviceArea}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Destination' }), {
      target: { value: 'State Street' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(screen.getByText('Searching…')).toBeVisible();

    await act(async () => {
      pending.resolve({ kind: 'results', suggestions });
      await pending.promise;
    });
  });

  it('explains that empty service-area results are limited to BCycle coverage', async () => {
    const search = vi.fn().mockResolvedValue({ kind: 'empty' });
    const user = userEvent.setup();
    render(
      <LocationSearch
        label="Destination"
        search={search}
        onSelectionChange={vi.fn()}
        serviceArea={serviceArea}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Destination' });
    await user.type(input, 'No such place{Enter}');

    const message =
      'No matching locations found within the current BCycle service area. Try a more specific address.';
    expect(await screen.findByText(message, { selector: 'p' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it.each([
    ['offline', 'You are offline. Address search requires a connection.'],
    ['rate_limited', 'Address search is temporarily rate-limited. Please wait and try again.'],
    ['network', 'Address search could not be completed. Check your connection and try again.'],
  ] as const)(
    'shows the %s search error without exposing raw provider text',
    async (code, message) => {
      const search = vi
        .fn()
        .mockRejectedValue(new GeocodingClientError(code, 'raw provider diagnostic'));
      const { input, user } = renderSearch(search);

      await user.type(input, 'Madison{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText('raw provider diagnostic')).not.toBeInTheDocument();
    },
  );

  it('explains valid coordinate ranges when submitted coordinates are out of range', async () => {
    const search = vi
      .fn()
      .mockRejectedValue(new GeocodingClientError('invalid_coordinates', 'raw range detail'));
    const { input, user } = renderSearch(search);

    await user.type(input, '91, -89{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Coordinates must use latitude from -90 to 90 and longitude from -180 to 180.',
    );
  });
});
