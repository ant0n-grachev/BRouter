import { act, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import StationMap from './StationMap';

vi.mock('./StationMapLeaflet', () => ({ default: () => null }));

describe('StationMap', () => {
  it('explains bikes/docks order with compact numeric examples without a disabled station example', async () => {
    render(
      <StationMap
        stations={[]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={[]}
        dropoffCandidateIds={[]}
        onSelectPickup={() => undefined}
        onSelectDropoff={() => undefined}
      />,
    );
    await act(async () => Promise.resolve());

    const legend = screen.getByLabelText('Station map legend');
    expect(within(legend).getByText('Bikes / docks')).toBeVisible();
    expect(
      within(legend)
        .getAllByText(/^\d+\/\d+$/)
        .map((element) => element.textContent),
    ).toEqual(['2/2', '2/0', '0/2', '0/0']);
    expect(within(legend).queryByText('×')).not.toBeInTheDocument();
    expect(within(legend).queryByText('Disabled station')).not.toBeInTheDocument();
  });

  it('explains when a planned-trip map is focused on the selectable station choices', async () => {
    render(
      <StationMap
        stations={[]}
        coverage={[]}
        origin={null}
        destination={null}
        selectedPickupId={null}
        selectedDropoffId={null}
        pickupCandidateIds={['pickup']}
        dropoffCandidateIds={['dropoff']}
        onSelectPickup={() => undefined}
        onSelectDropoff={() => undefined}
      />,
    );
    await act(async () => Promise.resolve());

    expect(
      screen.getByText(
        'Showing your pickup and drop-off choices. Tap a candidate marker to view details and choose pickup or drop-off. Selected stations have a bold outline. Use the map controls or arrow keys to move the map.',
      ),
    ).toBeVisible();
  });
});
