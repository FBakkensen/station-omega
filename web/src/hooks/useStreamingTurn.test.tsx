import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useStreamingTurn } from './useStreamingTurn';

type SegmentType =
  | 'narration'
  | 'dialogue'
  | 'thought'
  | 'station_pa'
  | 'crew_echo'
  | 'diagnostic_readout'
  | 'player_action';

interface RawSegmentDoc {
  turnNumber: number;
  segmentIndex: number;
  segment: {
    type: SegmentType;
    text: string;
    npcId: string | null;
    crewName: string | null;
  };
}

interface RawChoice {
  id: string;
  label: string;
  description: string;
}

interface QueryFixtures {
  rawSegments: RawSegmentDoc[] | undefined;
  isProcessing: boolean | undefined;
  rawChoices: { choices: RawChoice[] } | null | undefined;
}

type StartTurnResult = { ok: true; turnNumber: number } | { ok: false; error: string };
type StartTurnArgs = { gameId: Id<'games'>; playerInput: string };
type StartTurnHandler = (args: StartTurnArgs) => Promise<StartTurnResult>;

const convexMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
  useMutation: convexMocks.useMutation,
}));

describe('useStreamingTurn', () => {
  let fixtures: QueryFixtures;
  let startTurnHandler: StartTurnHandler;
  let startTurnCalls: StartTurnArgs[];

  beforeEach(() => {
    fixtures = {
      rawSegments: undefined,
      isProcessing: false,
      rawChoices: undefined,
    };

    startTurnCalls = [];
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 1 });
    };

    convexMocks.useQuery.mockReset();
    convexMocks.useMutation.mockReset();

    let queryCallCount = 0;
    convexMocks.useQuery.mockImplementation(() => {
      const slot = queryCallCount % 3;
      queryCallCount += 1;
      if (slot === 0) return fixtures.rawSegments;
      if (slot === 1) return fixtures.isProcessing;
      return fixtures.rawChoices;
    });

    convexMocks.useMutation.mockImplementation(() => {
      return (args: StartTurnArgs) => startTurnHandler(args);
    });
  });

  it('[Z] returns empty streaming state when no query data is available', () => {
    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_1',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    expect(result.current.segments).toEqual([]);
    expect(result.current.choices).toBeNull();
    expect(result.current.latestTurnStartIndex).toBe(0);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('[O] starts one turn and enters streaming when start mutation succeeds', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 2 });
    };

    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_2',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('scan relay');
    });

    expect(startTurnCalls).toEqual([
      {
        gameId: 'game_2' as Id<'games'>,
        playerInput: 'scan relay',
      },
    ]);
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('[M] computes latest turn start index across many prior segments', () => {
    fixtures.rawSegments = [
      {
        turnNumber: 1,
        segmentIndex: 0,
        segment: { type: 'narration', text: 'alpha', npcId: null, crewName: null },
      },
      {
        turnNumber: 1,
        segmentIndex: 1,
        segment: { type: 'dialogue', text: 'beta', npcId: 'npc_1', crewName: null },
      },
      {
        turnNumber: 2,
        segmentIndex: 0,
        segment: { type: 'narration', text: 'gamma', npcId: null, crewName: null },
      },
      {
        turnNumber: 2,
        segmentIndex: 1,
        segment: { type: 'dialogue', text: 'delta', npcId: 'npc_1', crewName: null },
      },
    ];

    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_3',
        stationData: { npcs: { npc_1: { name: 'Kade' } } },
        missionElapsedMinutes: 12,
      }),
    );

    expect(result.current.segments.map((s) => s.text)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(result.current.latestTurnStartIndex).toBe(2);
  });

  it('[B] exits streaming at the processing boundary when turn work finishes', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 7 });
    };

    const { result, rerender } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_4',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('repair coolant');
    });

    expect(result.current.isStreaming).toBe(true);

    fixtures.isProcessing = true;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    fixtures.isProcessing = false;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('[B] exits streaming when processing resolves from undefined to false after turn segments arrive', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 7 });
    };

    const { result, rerender } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_4b',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('stabilize power');
    });

    expect(result.current.isStreaming).toBe(true);

    fixtures.rawSegments = [
      {
        turnNumber: 7,
        segmentIndex: 0,
        segment: {
          type: 'narration',
          text: 'Power rerouted',
          npcId: null,
          crewName: null,
        },
      },
    ];
    fixtures.isProcessing = undefined;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    fixtures.isProcessing = false;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('[B] exits streaming when processing resolves from undefined to false with no active-turn segments', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 1 });
    };

    const { result, rerender } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_4c',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('steady thrusters');
    });

    expect(result.current.isStreaming).toBe(true);

    fixtures.rawSegments = undefined;
    fixtures.isProcessing = undefined;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    fixtures.isProcessing = false;
    rerender();

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('[I] preserves segment and choice interface mapping contracts', () => {
    fixtures.rawSegments = [
      {
        turnNumber: 1,
        segmentIndex: 0,
        segment: { type: 'narration', text: 'Status check', npcId: null, crewName: null },
      },
      {
        turnNumber: 1,
        segmentIndex: 1,
        segment: { type: 'dialogue', text: 'We are stable', npcId: 'npc_1', crewName: null },
      },
      {
        turnNumber: 1,
        segmentIndex: 2,
        segment: { type: 'crew_echo', text: 'Vitals normal', npcId: null, crewName: 'Inez' },
      },
    ];
    fixtures.rawChoices = {
      choices: [
        { id: 'choice_1', label: 'Inspect console', description: 'Look for fault traces' },
        { id: 'choice_2', label: 'Call crew', description: 'Ask for status report' },
      ],
    };

    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_5',
        stationData: {
          arrivalScenario: { playerCallsign: 'Vector' },
          npcs: { npc_1: { name: 'Kade' } },
          crewRoster: [{ name: 'Inez', role: 'Medic' }],
        },
        missionElapsedMinutes: 35,
      }),
    );

    expect(result.current.segments[0]).toMatchObject({
      type: 'narration',
      speakerName: 'Vector',
      segmentIndex: 0,
    });
    expect(result.current.segments[1]).toMatchObject({
      type: 'dialogue',
      speakerName: 'Kade',
      segmentIndex: 1,
    });
    expect(result.current.segments[2]).toMatchObject({
      type: 'crew_echo',
      speakerName: 'Inez — Medic',
      segmentIndex: 2,
    });
    expect(result.current.choices).toEqual(fixtures.rawChoices.choices);

    expect(convexMocks.useMutation).toHaveBeenCalledWith(api.turns.start);
    expect(convexMocks.useQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of convexMocks.useQuery.mock.calls) {
      expect(call[1]).toEqual({ gameId: 'game_5' as Id<'games'> });
    }
  });

  it('[E] reports explicit errors when starting a turn fails', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: false, error: 'Turn in progress' });
    };

    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_6',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('diagnose');
    });

    expect(result.current.error).toBe('Turn in progress');
    expect(result.current.isStreaming).toBe(false);
  });

  it('[S] ignores duplicate submit calls while a turn is already streaming', async () => {
    startTurnHandler = (args: StartTurnArgs) => {
      startTurnCalls.push(args);
      return Promise.resolve({ ok: true, turnNumber: 9 });
    };

    const { result } = renderHook(() =>
      useStreamingTurn({
        gameId: 'game_7',
        stationData: null,
        missionElapsedMinutes: 0,
      }),
    );

    await act(async () => {
      await result.current.submitTurn('scan');
    });
    await act(async () => {
      await result.current.submitTurn('scan again');
    });

    expect(startTurnCalls).toHaveLength(1);
    expect(startTurnCalls[0]).toEqual({
      gameId: 'game_7' as Id<'games'>,
      playerInput: 'scan',
    });
  });
});
