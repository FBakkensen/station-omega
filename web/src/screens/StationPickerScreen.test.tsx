import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
}));

describe('StationPickerScreen selection contracts', () => {
  let stationsFixture: StationRow[] | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stationsFixture = undefined;
    convexMocks.useQuery.mockImplementation(() => stationsFixture);
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

    await user.click(screen.getByRole('button', { name: /Icarus Wing/i }));

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

    await user.click(screen.getByRole('button', { name: /Aquila Gate/i }));
    await user.click(screen.getByRole('button', { name: /Cinder Deck/i }));

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
