import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../convex/_generated/api';
import { StationPickerScreen } from './StationPickerScreen';

type StationRow = {
  _id: string;
  _creationTime: number;
  stationName: string;
  briefing: string;
  difficulty: 'normal' | 'hard' | 'nightmare';
};

const convexMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  removeStation: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
  useMutation: convexMocks.useMutation,
}));

describe('StationPickerScreen selection contracts', () => {
  let stationsFixture: StationRow[] | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stationsFixture = undefined;
    convexMocks.useQuery.mockImplementation(() => stationsFixture);
    convexMocks.removeStation.mockResolvedValue(null);
    convexMocks.useMutation.mockImplementation(() => convexMocks.removeStation);
  });

  afterEach(() => {
    cleanup();
  });

  it('[Z] shows zero-ready loading copy when stations query is undefined', () => {
    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('[O] selects one station entry and sends one matching station id to callback', async () => {
    stationsFixture = [
      {
        _id: 'station_1',
        _creationTime: 1,
        stationName: 'Icarus Wing',
        briefing: 'Repair and evacuate.',
        difficulty: 'normal',
      },
    ];
    const user = userEvent.setup();
    const onSelectStation = vi.fn();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={onSelectStation}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Icarus Wing.*Repair and evacuate\./i }));

    expect(onSelectStation).toHaveBeenCalledTimes(1);
    expect(onSelectStation).toHaveBeenCalledWith('station_1');
  });

  it('[M] renders many station rows with independent selection across multiple choices', async () => {
    stationsFixture = [
      {
        _id: 'station_a',
        _creationTime: 1,
        stationName: 'Aquila Gate',
        briefing: 'Hold containment line.',
        difficulty: 'hard',
      },
      {
        _id: 'station_b',
        _creationTime: 2,
        stationName: 'Borealis Rack',
        briefing: 'Stabilize power net.',
        difficulty: 'normal',
      },
      {
        _id: 'station_c',
        _creationTime: 3,
        stationName: 'Cinder Deck',
        briefing: 'Restore cooling loop.',
        difficulty: 'nightmare',
      },
    ];
    const user = userEvent.setup();
    const onSelectStation = vi.fn();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={onSelectStation}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Aquila Gate.*Hold containment line\./i }));
    await user.click(screen.getByRole('button', { name: /Cinder Deck.*Restore cooling loop\./i }));

    const selectedCalls = onSelectStation.mock.calls as Array<[string]>;
    expect(selectedCalls.map(([value]) => value)).toEqual(['station_a', 'station_c']);
  });

  it('[B] shows boundary empty-state copy when the station list is present but empty', () => {
    stationsFixture = [];

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('No saved stations yet. Generate one above.')).toBeInTheDocument();
  });

  it('[I] maps station metadata interface labels for name briefing and difficulty fields', () => {
    stationsFixture = [
      {
        _id: 'station_meta',
        _creationTime: 5,
        stationName: 'Metadata Prime',
        briefing: 'Inspect metadata rendering.',
        difficulty: 'nightmare',
      },
    ];

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Metadata Prime')).toBeInTheDocument();
    expect(screen.getByText('Inspect metadata rendering.')).toBeInTheDocument();
    expect(screen.getByText('nightmare')).toBeInTheDocument();
  });

  it('[E] tolerates malformed optional station briefing values without throwing UI errors', () => {
    stationsFixture = [
      {
        _id: 'station_err',
        _creationTime: 6,
        stationName: 'Error-safe Station',
        briefing: '',
        difficulty: 'normal',
      },
    ];

    expect(() =>
      render(
        <StationPickerScreen
          onGenerate={vi.fn()}
          onSelectStation={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('Error-safe Station')).toBeInTheDocument();
  });

  it('[S] follows standard navigation flow for generate and back controls', async () => {
    stationsFixture = [];
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onBack = vi.fn();

    render(
      <StationPickerScreen
        onGenerate={onGenerate}
        onSelectStation={vi.fn()}
        onBack={onBack}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Generate New Station/i }));
    await user.click(screen.getByRole('button', { name: /Back/i }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('StationPickerScreen deletion contracts', () => {
  let stationsFixture: StationRow[] | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stationsFixture = undefined;
    convexMocks.useQuery.mockImplementation(() => stationsFixture);
    convexMocks.removeStation.mockResolvedValue(null);
    convexMocks.useMutation.mockImplementation(() => convexMocks.removeStation);
  });

  afterEach(() => {
    cleanup();
  });

  it('[Z] renders no delete confirmation dialog across loading and empty station states', () => {
    const view = render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog', { name: /delete station/i })).not.toBeInTheDocument();

    stationsFixture = [];
    view.rerender(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('No saved stations yet. Generate one above.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /delete station/i })).not.toBeInTheDocument();
  });

  it('[O] opens one confirmation dialog for one station delete icon', async () => {
    stationsFixture = [
      {
        _id: 'station_delete_one',
        _creationTime: 1,
        stationName: 'Orpheus Ring',
        briefing: 'Hold the airlock.',
        difficulty: 'hard',
      },
    ];
    const user = userEvent.setup();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete orpheus ring/i }));

    const dialog = screen.getByRole('dialog', { name: /delete station/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/orpheus ring/i)).toBeInTheDocument();
  });

  it('[M] prevents many rapid confirm clicks from issuing multiple delete mutations while pending', async () => {
    stationsFixture = [
      {
        _id: 'station_many_delete',
        _creationTime: 1,
        stationName: 'Kepler Spine',
        briefing: 'Stabilize the breach.',
        difficulty: 'nightmare',
      },
    ];
    let resolveDelete!: () => void;
    convexMocks.removeStation.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolveDelete = () => {
            resolve(null);
          };
        }),
    );
    const user = userEvent.setup();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete kepler spine/i }));
    const confirmButton = screen.getByRole('button', { name: /delete station/i });

    await Promise.all([user.click(confirmButton), user.click(confirmButton), user.click(confirmButton)]);

    expect(convexMocks.removeStation).toHaveBeenCalledTimes(1);
    expect(confirmButton).toBeDisabled();

    resolveDelete();
  });

  it('[B] preserves hover and focus visibility classes for the hidden delete icon affordance', () => {
    stationsFixture = [
      {
        _id: 'station_boundary_delete',
        _creationTime: 1,
        stationName: 'Boundary Loom',
        briefing: 'Check the relay edge.',
        difficulty: 'normal',
      },
    ];

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: /delete boundary loom/i });
    expect(deleteButton.className).toContain('opacity-0');
    expect(deleteButton.className).toContain('group-hover:opacity-100');
    expect(deleteButton.className).toContain('group-focus-within:opacity-100');
  });

  it('[I] sends the exact station id to the remove mutation and exposes an accessible delete label', async () => {
    stationsFixture = [
      {
        _id: 'station_interface_delete',
        _creationTime: 1,
        stationName: 'Interface Array',
        briefing: 'Inspect the contract.',
        difficulty: 'hard',
      },
    ];
    const user = userEvent.setup();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete interface array/i }));
    await user.click(screen.getByRole('button', { name: /delete station/i }));

    expect(convexMocks.useMutation).toHaveBeenCalledWith(api.stations.remove);
    expect(convexMocks.removeStation).toHaveBeenCalledWith({ id: 'station_interface_delete' });
  });

  it('[E] keeps the confirmation dialog open and shows an inline error when deletion fails', async () => {
    stationsFixture = [
      {
        _id: 'station_error_delete',
        _creationTime: 1,
        stationName: 'Fault Lattice',
        briefing: 'Deletion should fail.',
        difficulty: 'hard',
      },
    ];
    convexMocks.removeStation.mockRejectedValueOnce(new Error('delete failed'));
    const user = userEvent.setup();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete fault lattice/i }));
    await user.click(screen.getByRole('button', { name: /delete station/i }));

    expect(await screen.findByText(/unable to delete station/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /delete station/i })).toBeInTheDocument();
  });

  it('[S] completes the standard confirm-delete flow without selecting the station row', async () => {
    stationsFixture = [
      {
        _id: 'station_standard_delete',
        _creationTime: 1,
        stationName: 'Standard Halo',
        briefing: 'Delete without launch.',
        difficulty: 'normal',
      },
    ];
    const user = userEvent.setup();
    const onSelectStation = vi.fn();

    render(
      <StationPickerScreen
        onGenerate={vi.fn()}
        onSelectStation={onSelectStation}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete standard halo/i }));
    await user.click(screen.getByRole('button', { name: /delete station/i }));

    expect(convexMocks.removeStation).toHaveBeenCalledWith({ id: 'station_standard_delete' });
    expect(onSelectStation).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /delete station/i })).not.toBeInTheDocument();
  });
});
