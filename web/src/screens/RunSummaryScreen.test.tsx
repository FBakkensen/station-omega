import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../convex/_generated/api';
import { RunSummaryScreen } from './RunSummaryScreen';

type Metrics = {
  runId: string;
  characterClass: string;
  storyArc: string;
  difficulty: string;
  startTime: number;
  endTime: number | null;
  turnCount: number;
  missionElapsedMinutes: number;
  moveCount: number;
  totalDamageTaken: number;
  totalDamageHealed: number;
  roomsVisited: string[];
  itemsUsed: string[];
  itemsCollected: string[];
  crewLogsFound: number;
  creativeActionsAttempted: number;
  deathCause: string | null;
  won: boolean;
  endingId: string | null;
  systemsDiagnosed: number;
  systemsRepaired: number;
  systemsCascaded: number;
  itemsCrafted: number;
  improvizedSolutions: number;
};

type GameDoc = {
  stationId?: string;
  characterClass: 'engineer' | 'scientist' | 'medic' | 'commander';
  difficulty: 'normal' | 'hard' | 'nightmare';
  won: boolean;
  turnCount: number;
  state?: {
    metrics?: Metrics;
  };
};

type StationDoc = {
  data?: {
    rooms?: Record<string, unknown>;
  };
};

const convexMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  saveRun: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
  useMutation: convexMocks.useMutation,
}));

function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    runId: 'run_1',
    characterClass: 'engineer',
    storyArc: 'cascade_failure',
    difficulty: 'normal',
    startTime: 1_000,
    endTime: 7_000,
    turnCount: 8,
    missionElapsedMinutes: 42,
    moveCount: 6,
    totalDamageTaken: 20,
    totalDamageHealed: 10,
    roomsVisited: ['room_0', 'room_1', 'room_2'],
    itemsUsed: ['item_wire'],
    itemsCollected: ['item_wire', 'item_keycard'],
    crewLogsFound: 2,
    creativeActionsAttempted: 1,
    deathCause: null,
    won: true,
    endingId: 'escape_success',
    systemsDiagnosed: 2,
    systemsRepaired: 2,
    systemsCascaded: 0,
    itemsCrafted: 1,
    improvizedSolutions: 1,
    ...overrides,
  };
}

describe('RunSummaryScreen contracts', () => {
  let gameFixture: GameDoc | null | undefined;
  let stationFixture: StationDoc | null | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    gameFixture = undefined;
    stationFixture = undefined;
    convexMocks.saveRun.mockResolvedValue(null);
    convexMocks.useMutation.mockImplementation(() => convexMocks.saveRun);
    let queryCallCount = 0;
    convexMocks.useQuery.mockImplementation((queryRef: unknown, args: unknown) => {
      if (queryRef === api.games.get) return gameFixture;
      if (queryRef === api.stations.get) {
        if (args === 'skip') return undefined;
        return stationFixture;
      }

      // Fallback for proxy identity edge cases: in this component, calls alternate game -> station.
      const slot = queryCallCount % 2;
      queryCallCount += 1;
      if (slot === 0) return gameFixture;
      if (args === 'skip') return undefined;
      return stationFixture;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('[Z] shows loading state for zero metrics and does not persist run history', async () => {
    gameFixture = {
      stationId: 'station_0',
      characterClass: 'engineer',
      difficulty: 'normal',
      won: false,
      turnCount: 0,
      state: {},
    };
    stationFixture = { data: { rooms: { room_0: {} } } };

    render(<RunSummaryScreen gameId="game_zero" onTitle={vi.fn()} onHistory={vi.fn()} />);

    expect(screen.getByText('Loading results...')).toBeInTheDocument();
    await waitFor(() => {
      expect(convexMocks.saveRun).not.toHaveBeenCalled();
    });
  });

  it('[O] renders one completed run summary and saves one history entry', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(9_000);
    gameFixture = {
      stationId: 'station_1',
      characterClass: 'engineer',
      difficulty: 'normal',
      won: true,
      turnCount: 8,
      state: { metrics: makeMetrics() },
    };
    stationFixture = { data: { rooms: { room_0: {}, room_1: {}, room_2: {} } } };

    render(<RunSummaryScreen gameId="game_one" onTitle={vi.fn()} onHistory={vi.fn()} />);

    expect(screen.getByText('Mission Complete')).toBeInTheDocument();
    await waitFor(() => {
      expect(convexMocks.saveRun).toHaveBeenCalledTimes(1);
    });
    expect(convexMocks.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: 'game_one',
        characterClass: 'engineer',
        difficulty: 'normal',
        won: true,
        turnCount: 8,
      }),
    );

    nowSpy.mockRestore();
  });

  it('[M] saves once across many rerenders and avoids multi-write duplication', async () => {
    gameFixture = {
      stationId: 'station_many',
      characterClass: 'medic',
      difficulty: 'hard',
      won: false,
      turnCount: 14,
      state: { metrics: makeMetrics({ won: false, endingId: 'failure_cascade' }) },
    };
    stationFixture = { data: { rooms: { room_0: {}, room_1: {} } } };

    const view = render(<RunSummaryScreen gameId="game_many" onTitle={vi.fn()} onHistory={vi.fn()} />);
    view.rerender(<RunSummaryScreen gameId="game_many" onTitle={vi.fn()} onHistory={vi.fn()} />);
    view.rerender(<RunSummaryScreen gameId="game_many" onTitle={vi.fn()} onHistory={vi.fn()} />);

    await waitFor(() => {
      expect(convexMocks.saveRun).toHaveBeenCalledTimes(1);
    });
  });

  it('[B] uses boundary fallback room count when station room payload is missing', async () => {
    gameFixture = {
      stationId: 'station_boundary',
      characterClass: 'scientist',
      difficulty: 'nightmare',
      won: true,
      turnCount: 6,
      state: { metrics: makeMetrics({ roomsVisited: ['room_0', 'room_1'] }) },
    };
    stationFixture = {};

    render(<RunSummaryScreen gameId="game_boundary" onTitle={vi.fn()} onHistory={vi.fn()} />);

    await waitFor(() => {
      expect(convexMocks.saveRun).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Mission Complete|Mission Failed/)).toBeInTheDocument();
  });

  it('[I] persists run-history interface contract fields including nested score shape', async () => {
    gameFixture = {
      stationId: 'station_interface',
      characterClass: 'commander',
      difficulty: 'hard',
      won: false,
      turnCount: 22,
      state: {
        metrics: makeMetrics({
          won: false,
          endingId: 'decompression',
          endTime: null,
          missionElapsedMinutes: 73,
        }),
      },
    };
    stationFixture = { data: { rooms: { room_0: {}, room_1: {}, room_2: {}, room_3: {} } } };

    render(<RunSummaryScreen gameId="game_interface" onTitle={vi.fn()} onHistory={vi.fn()} />);

    await waitFor(() => {
      expect(convexMocks.saveRun).toHaveBeenCalledTimes(1);
    });

    const payload = convexMocks.saveRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['gameId']).toBe('game_interface');
    expect(payload['characterClass']).toBe('commander');
    expect(payload['difficulty']).toBe('hard');
    expect(payload['won']).toBe(false);
    expect(payload['endingId']).toBe('decompression');
    expect(payload['turnCount']).toBe(22);
    const score = payload['score'];
    if (!score || typeof score !== 'object') throw new Error('missing score payload');
    const typedScore = score as Record<string, unknown>;
    expect(typeof typedScore['speed']).toBe('number');
    expect(typeof typedScore['engineeringEfficiency']).toBe('number');
    expect(typeof typedScore['exploration']).toBe('number');
    expect(typeof typedScore['resourcefulness']).toBe('number');
    expect(typeof typedScore['completion']).toBe('number');
    expect(typeof typedScore['total']).toBe('number');
    expect(typeof typedScore['grade']).toBe('string');
  });

  it('[E] tolerates error-adjacent station query gaps without throwing and still renders summary data', () => {
    gameFixture = {
      stationId: 'station_gap',
      characterClass: 'engineer',
      difficulty: 'normal',
      won: true,
      turnCount: 4,
      state: { metrics: makeMetrics() },
    };
    stationFixture = undefined;

    expect(() =>
      render(<RunSummaryScreen gameId="game_gap" onTitle={vi.fn()} onHistory={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByText('Mission Complete')).toBeInTheDocument();
  });

  it('[S] follows standard navigation flow by firing history and title callbacks from action buttons', async () => {
    gameFixture = {
      stationId: 'station_standard',
      characterClass: 'engineer',
      difficulty: 'normal',
      won: true,
      turnCount: 9,
      state: { metrics: makeMetrics() },
    };
    stationFixture = { data: { rooms: { room_0: {}, room_1: {}, room_2: {} } } };
    const user = userEvent.setup();
    const onHistory = vi.fn();
    const onTitle = vi.fn();

    render(<RunSummaryScreen gameId="game_standard" onTitle={onTitle} onHistory={onHistory} />);

    await user.click(screen.getByRole('button', { name: 'Run History' }));
    await user.click(screen.getByRole('button', { name: 'Main Menu' }));

    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onTitle).toHaveBeenCalledTimes(1);
  });
});
