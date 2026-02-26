import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../convex/_generated/api';
import { GameplayScreen } from './GameplayScreen';
import type { DisplaySegment, Choice } from '../engine/types';

type StreamingFixture = {
  segments: DisplaySegment[];
  latestTurnStartIndex: number;
  isStreaming: boolean;
  submitTurn: ReturnType<typeof vi.fn>;
  choices: Choice[] | null;
  error: string | null;
  clearError: ReturnType<typeof vi.fn>;
};

type TypewriterPushCall = {
  segmentIndex: number;
  immediate: boolean;
};

const mocks = vi.hoisted(() => {
  return {
    useQueryMock: vi.fn(),
    useStreamingTurnMock: vi.fn(),
    useTypewriterMock: vi.fn(),
    useTTSMock: vi.fn(),
    usePreferencesMock: vi.fn(),
    useDevSettingsMock: vi.fn(),
    twPushSegmentMock: vi.fn(),
    twOnRevealChunkMock: vi.fn(),
    twFinalizeAllMock: vi.fn(),
    twSkipCurrentMock: vi.fn(),
    ttsPushSegmentMock: vi.fn(),
    ttsBeginStreamMock: vi.fn(),
    ttsFlushStreamMock: vi.fn(),
    ttsStopMock: vi.fn(),
    typewriterPushCalls: [] as TypewriterPushCall[],
  };
});

vi.mock('convex/react', () => ({
  useQuery: mocks.useQueryMock,
}));

vi.mock('../hooks/useStreamingTurn', () => ({
  useStreamingTurn: mocks.useStreamingTurnMock,
}));

vi.mock('../hooks/useTypewriter', () => ({
  useTypewriter: mocks.useTypewriterMock,
}));

vi.mock('../hooks/useTTS', () => ({
  useTTS: mocks.useTTSMock,
}));

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: mocks.usePreferencesMock,
}));

vi.mock('../hooks/useDevSettings', () => ({
  useDevSettings: mocks.useDevSettingsMock,
}));

vi.mock('../components/sidebar/Sidebar', () => ({
  Sidebar: () => null,
}));

vi.mock('../components/narrative/NarrativePanel', () => ({
  NarrativePanel: () => null,
}));

vi.mock('../components/input/CommandInput', () => ({
  CommandInput: () => null,
}));

vi.mock('../components/modals/MapModal', () => ({
  MapModal: () => null,
}));

vi.mock('../components/modals/MissionModal', () => ({
  MissionModal: () => null,
}));

function makeDisplaySegment(
  segmentIndex: number,
  text: string,
  type: DisplaySegment['type'] = 'narration',
): DisplaySegment {
  return {
    segmentIndex,
    type,
    text,
    npcId: null,
    crewName: null,
    speakerName: 'Vector',
  };
}

function makeGameDoc() {
  return {
    state: {
      hp: 100,
      maxHp: 100,
      oxygen: 100,
      maxOxygen: 100,
      suitIntegrity: 100,
      characterClass: 'engineer',
      missionElapsedMinutes: 5,
      currentRoom: 'room_0',
      roomsVisited: ['room_0'],
      inventory: [],
      maxInventory: 6,
      activeEvents: [],
    },
    isOver: false,
    won: false,
    turnCount: 2,
    characterClass: 'engineer',
    difficulty: 'normal',
  };
}

function makeStationDoc() {
  return {
    stationName: 'Station Omega Test',
    data: {
      rooms: {
        room_0: {
          id: 'room_0',
          name: 'Docking Vestibule',
          archetype: 'entry',
          connections: [],
          depth: 0,
          systemFailures: [],
        },
      },
      items: {},
      objectives: {
        title: 'Stabilize Reactor',
        steps: [{ description: 'Assess status', completed: false }],
        currentStepIndex: 0,
        completed: false,
      },
      arrivalScenario: {
        playerCallsign: 'Vector',
      },
    },
  };
}

describe('GameplayScreen reload hydration behavior', () => {
  let streamingFixture: StreamingFixture;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_CONVEX_URL', 'https://station-omega-test.cloud');

    const seenSegments = new Set<number>();
    mocks.typewriterPushCalls.length = 0;

    mocks.twPushSegmentMock.mockImplementation((segment: DisplaySegment, immediate?: boolean) => {
      const isImmediate = immediate === true;
      mocks.typewriterPushCalls.push({
        segmentIndex: segment.segmentIndex,
        immediate: isImmediate,
      });
      if (seenSegments.has(segment.segmentIndex)) return -1;
      seenSegments.add(segment.segmentIndex);
      return isImmediate ? -1 : 24;
    });

    mocks.useTypewriterMock.mockReturnValue({
      cards: new Map(),
      pushSegment: mocks.twPushSegmentMock,
      onRevealChunk: mocks.twOnRevealChunkMock,
      finalizeAll: mocks.twFinalizeAllMock,
      finalizeSegment: vi.fn(),
      skipCurrent: mocks.twSkipCurrentMock,
      allFinalized: true,
    });

    mocks.useTTSMock.mockReturnValue({
      pushSegment: mocks.ttsPushSegmentMock,
      beginStream: mocks.ttsBeginStreamMock,
      flushStream: mocks.ttsFlushStreamMock,
      stop: mocks.ttsStopMock,
    });

    mocks.usePreferencesMock.mockReturnValue({
      soundEnabled: true,
      setSoundEnabled: vi.fn(),
    });

    mocks.useDevSettingsMock.mockReturnValue({
      enabled: false,
      forceMute: false,
      typewriterCharsPerSec: 20,
    });

    const gameDoc = makeGameDoc();
    const stationDoc = makeStationDoc();
    mocks.useQueryMock.mockImplementation((queryRef: unknown) => {
      if (queryRef === api.games.get) return gameDoc;
      if (queryRef === api.stations.get) return stationDoc;
      return undefined;
    });

    streamingFixture = {
      segments: [],
      latestTurnStartIndex: 0,
      isStreaming: false,
      submitTurn: vi.fn(),
      choices: null,
      error: null,
      clearError: vi.fn(),
    };
    mocks.useStreamingTurnMock.mockImplementation(() => streamingFixture);
  });

  it('[Z] keeps zero persisted segments in a stable initial no-op state without replay', () => {
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.twPushSegmentMock).not.toHaveBeenCalled();
    expect(mocks.ttsPushSegmentMock).not.toHaveBeenCalled();
  });

  it('[O] hydrates one persisted segment as immediate without triggering replay animation or speech', () => {
    streamingFixture.segments = [makeDisplaySegment(0, 'single persisted segment')];
    streamingFixture.latestTurnStartIndex = 1;

    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.typewriterPushCalls).toEqual([
      { segmentIndex: 0, immediate: true },
    ]);
    expect(mocks.ttsPushSegmentMock).not.toHaveBeenCalled();
  });

  it('[M] hydrates many persisted latest-turn segments on reload without multi-segment replay', () => {
    streamingFixture.segments = [
      makeDisplaySegment(0, 'prior turn alpha'),
      makeDisplaySegment(1, 'prior turn beta'),
      makeDisplaySegment(2, 'latest turn gamma'),
      makeDisplaySegment(3, 'latest turn delta'),
    ];
    streamingFixture.latestTurnStartIndex = 2;
    streamingFixture.isStreaming = true;

    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.typewriterPushCalls).toEqual([
      { segmentIndex: 0, immediate: true },
      { segmentIndex: 1, immediate: true },
      { segmentIndex: 2, immediate: true },
      { segmentIndex: 3, immediate: true },
    ]);
    expect(mocks.ttsPushSegmentMock).not.toHaveBeenCalled();
  });

  it('[B] preserves boundary behavior: persisted segments stay frozen and only new appended segments stream', () => {
    streamingFixture.segments = [
      makeDisplaySegment(0, 'persisted one'),
      makeDisplaySegment(1, 'persisted two'),
    ];
    streamingFixture.latestTurnStartIndex = 0;
    streamingFixture.isStreaming = true;

    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    streamingFixture.segments = [
      makeDisplaySegment(0, 'persisted one'),
      makeDisplaySegment(1, 'persisted two'),
      makeDisplaySegment(2, 'newly streamed'),
    ];
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    const firstPushes = mocks.typewriterPushCalls.slice(0, 2);
    const latestPush = mocks.typewriterPushCalls.find((call) => call.segmentIndex === 2);

    expect(firstPushes).toEqual([
      { segmentIndex: 0, immediate: true },
      { segmentIndex: 1, immediate: true },
    ]);
    expect(latestPush).toEqual({ segmentIndex: 2, immediate: false });
    expect(mocks.ttsPushSegmentMock).toHaveBeenCalledTimes(1);
    expect(mocks.ttsPushSegmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ segmentIndex: 2 }),
      24,
    );
  });

  it('[I] preserves the typewriter-to-tts callback interface contract on hook wiring', () => {
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.useTTSMock).toHaveBeenCalledTimes(1);
    const ttsArgs = mocks.useTTSMock.mock.calls[0];
    expect(ttsArgs[0]).toBe('https://station-omega-test.site/api/tts');
    expect(ttsArgs[2]).toBe(mocks.twOnRevealChunkMock);
    expect(ttsArgs[3]).toBe(mocks.twFinalizeAllMock);
  });

  it('[E] tolerates malformed duplicate segment state without replaying or throwing errors', () => {
    streamingFixture.segments = [
      makeDisplaySegment(7, ''),
      makeDisplaySegment(7, 'duplicate persisted payload'),
    ];
    streamingFixture.latestTurnStartIndex = 1;
    streamingFixture.isStreaming = true;

    expect(() => {
      render(
        <GameplayScreen
          gameId="j9733s5p0przppv68h942xqd6n81nxmb"
          stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
          onGameOver={vi.fn()}
          onRunSummary={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(mocks.ttsPushSegmentMock).not.toHaveBeenCalled();
  });

  it('[S] follows the standard stream lifecycle by starting and flushing once per turn transition', () => {
    streamingFixture.isStreaming = true;

    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.twFinalizeAllMock).toHaveBeenCalledTimes(1);
    expect(mocks.ttsBeginStreamMock).toHaveBeenCalledTimes(1);
    expect(mocks.ttsFlushStreamMock).not.toHaveBeenCalled();

    streamingFixture.isStreaming = false;
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
      />,
    );

    expect(mocks.ttsFlushStreamMock).toHaveBeenCalledTimes(1);
  });
});
