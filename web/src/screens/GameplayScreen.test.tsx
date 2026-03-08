import { act, render } from '@testing-library/react';
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
  choiceTitle: string | null;
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
    lastMissionModalOnClose: null as (() => void) | null,
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
  MissionModal: (props: { onClose?: () => void }) => {
    mocks.lastMissionModalOnClose = props.onClose ?? null;
    return null;
  },
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
      choiceTitle: null,
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
          onQuit={vi.fn()}
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
        onQuit={vi.fn()}
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
        onQuit={vi.fn()}
      />,
    );

    expect(mocks.ttsFlushStreamMock).toHaveBeenCalledTimes(1);
  });
});

describe('GameplayScreen initial briefing gate', () => {
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

    // Fresh game with turnCount: 0
    const gameDoc = { ...makeGameDoc(), turnCount: 0 };
    const stationDoc = makeStationDoc();
    // Return game/station based on call order: 1st=game, 2nd=station, 3rd+=undefined
    let useQueryCallCount = 0;
    mocks.useQueryMock.mockImplementation(() => {
      useQueryCallCount++;
      const idx = ((useQueryCallCount - 1) % 3);
      if (idx === 0) return gameDoc;
      if (idx === 1) return stationDoc;
      return undefined;
    });

    streamingFixture = {
      segments: [],
      latestTurnStartIndex: 0,
      isStreaming: false,
      submitTurn: vi.fn(),
      choices: null,
      choiceTitle: null,
      error: null,
      clearError: vi.fn(),
    };
    mocks.useStreamingTurnMock.mockImplementation(() => streamingFixture);
  });

  it('[Z] suppresses typewriter/TTS while initial briefing is visible — zero presentation before dismissal', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Turn submitted immediately
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);

    // Simulate segments arriving while briefing is still up
    streamingFixture.segments = [makeDisplaySegment(0, 'You arrive.')];
    streamingFixture.isStreaming = true;
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Presentation suppressed — zero typewriter/TTS activity
    expect(mocks.twPushSegmentMock).not.toHaveBeenCalled();
    expect(mocks.ttsBeginStreamMock).not.toHaveBeenCalled();
  });

  it('[O] auto-submits exactly one first turn immediately on mount', () => {
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Submitted immediately — no need to dismiss briefing first
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
    expect(streamingFixture.submitTurn).toHaveBeenCalledWith('I look around and take in my surroundings.');

    // Dismissing briefing does not re-submit
    act(() => { mocks.lastMissionModalOnClose?.(); });
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
  });

  it('[M] does not re-submit first turn on multiple rerenders', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
  });

  it('[B] does not block first turn when turnCount is already > 0', () => {
    const gameDoc = { ...makeGameDoc(), turnCount: 2 };
    const stationDoc = makeStationDoc();
    let callCount = 0;
    mocks.useQueryMock.mockImplementation(() => {
      callCount++;
      const idx = ((callCount - 1) % 3);
      if (idx === 0) return gameDoc;
      if (idx === 1) return stationDoc;
      return undefined;
    });

    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // turnCount > 0 means the guard on turnCount !== 0 returns early,
    // so submitTurn should NOT be called (it's not a fresh game)
    expect(streamingFixture.submitTurn).not.toHaveBeenCalled();
  });

  it('[I] submits first turn immediately while mission modal is visible on fresh game', () => {
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Turn is submitted immediately even though mission modal is still visible
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
    // MissionModal onClose callback is set (modal is rendered)
    expect(mocks.lastMissionModalOnClose).not.toBeNull();
  });

  it('[E] handles missing game doc gracefully without submitting', () => {
    mocks.useQueryMock.mockImplementation(() => undefined);

    expect(() => {
      render(
        <GameplayScreen
          gameId="j9733s5p0przppv68h942xqd6n81nxmb"
          stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
          onGameOver={vi.fn()}
          onRunSummary={vi.fn()}
          onQuit={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(streamingFixture.submitTurn).not.toHaveBeenCalled();
  });

  it('[S] follows standard flow: submits immediately and presents after briefing dismissal', () => {
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Turn submitted immediately on mount
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
    expect(streamingFixture.submitTurn).toHaveBeenCalledWith('I look around and take in my surroundings.');

    // Presentation suppressed while briefing is visible
    expect(mocks.twPushSegmentMock).not.toHaveBeenCalled();

    // Dismiss via MissionModal onClose callback
    act(() => { mocks.lastMissionModalOnClose?.(); });

    // No duplicate submit after dismissal
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);
  });
});

describe('GameplayScreen mission modal close behavior', () => {
  let streamingFixture: StreamingFixture;
  let gameDoc: ReturnType<typeof makeGameDoc>;
  let stationDoc: ReturnType<typeof makeStationDoc>;

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

    mocks.lastMissionModalOnClose = null;

    gameDoc = { ...makeGameDoc(), turnCount: 0 };
    stationDoc = makeStationDoc();
    let useQueryCallCount = 0;
    mocks.useQueryMock.mockImplementation(() => {
      useQueryCallCount++;
      const idx = ((useQueryCallCount - 1) % 3);
      if (idx === 0) return gameDoc;
      if (idx === 1) return stationDoc;
      return undefined;
    });

    streamingFixture = {
      segments: [],
      latestTurnStartIndex: 0,
      isStreaming: false,
      submitTurn: vi.fn(),
      choices: null,
      choiceTitle: null,
      error: null,
      clearError: vi.fn(),
    };
    mocks.useStreamingTurnMock.mockImplementation(() => streamingFixture);
  });

  it('[Z] mission modal stays open when turnCount changes from 0 to 1 and user has not dismissed', () => {
    // Render with fresh game (turnCount=0) — mission modal should be visible
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Mission modal is rendered (onClose callback was captured)
    expect(mocks.lastMissionModalOnClose).not.toBeNull();

    // Simulate first turn completing: turnCount goes from 0 to 1
    gameDoc.turnCount = 1;
    streamingFixture.isStreaming = false;
    streamingFixture.segments = [makeDisplaySegment(0, 'You arrive at the station.')];

    mocks.lastMissionModalOnClose = null; // reset so we can detect if modal re-renders
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // BUG: The modal closes because showInitialBriefing depends on turnCount === 0
    // EXPECTED: The modal should still be open — user hasn't dismissed it yet
    expect(mocks.lastMissionModalOnClose).not.toBeNull();
  });

  it('[O] single explicit dismissal is the only transition that closes the initial briefing modal', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Modal is initially visible
    expect(mocks.lastMissionModalOnClose).not.toBeNull();

    // Simulate turn completing — turnCount goes from 0 to 1
    gameDoc.turnCount = 1;
    streamingFixture.isStreaming = false;
    streamingFixture.segments = [makeDisplaySegment(0, 'You arrive.')];

    // Reset the captured onClose to detect if MissionModal re-renders
    mocks.lastMissionModalOnClose = null;
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // BUG: Modal should still be visible after turnCount changes
    // (lastMissionModalOnClose is set when MissionModal renders)
    expect(mocks.lastMissionModalOnClose).not.toBeNull();
  });

  it('[M] segments are held back until user dismisses mission modal even after multiple turnCount changes', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Segments arrive while briefing is up
    streamingFixture.segments = [
      makeDisplaySegment(0, 'First segment'),
      makeDisplaySegment(1, 'Second segment'),
    ];
    streamingFixture.isStreaming = true;
    gameDoc.turnCount = 1;

    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Segments should NOT have been pushed — briefing still visible
    expect(mocks.twPushSegmentMock).not.toHaveBeenCalled();
  });

  it('[B] when user dismisses modal before first turn finishes, segments play as soon as they arrive', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // User dismisses the briefing immediately (before any segments arrive)
    act(() => { mocks.lastMissionModalOnClose?.(); });

    // Now segments arrive
    streamingFixture.segments = [makeDisplaySegment(0, 'You look around.')];
    streamingFixture.isStreaming = true;
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Segments should be pushed immediately — no briefing gate
    expect(mocks.twPushSegmentMock).toHaveBeenCalled();
  });

  it('[I] non-initial turn does not auto-close mission modal — showMission state is user-controlled', () => {
    // Start with turnCount > 0 so this is NOT an initial briefing
    gameDoc.turnCount = 2;

    // Render — no initial briefing, no auto-submit
    render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // MissionModal should NOT be rendered (showMission defaults to false, no initial briefing)
    expect(mocks.lastMissionModalOnClose).toBeNull();

    // Verify no auto-submission on non-initial game
    expect(streamingFixture.submitTurn).not.toHaveBeenCalled();

    // Segments should flow normally on non-initial turns (no briefing gate)
    // This is verified by the reload hydration tests above
  });

  it('[E] non-initial turn tolerates missing briefing gate and streams segments normally', () => {
    // Start with turnCount > 0 (not initial)
    gameDoc.turnCount = 2;

    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Segments arrive
    streamingFixture.isStreaming = true;
    streamingFixture.segments = [
      makeDisplaySegment(0, 'prior turn'),
      makeDisplaySegment(1, 'new segment in background'),
    ];
    streamingFixture.latestTurnStartIndex = 1;
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Segments should be pushed — no briefing gate on non-initial turns
    expect(mocks.twPushSegmentMock).toHaveBeenCalled();
  });

  it('[S] initial turn: full lifecycle — modal stays, user dismisses, segments flow', () => {
    const view = render(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Step 1: Turn auto-submitted
    expect(streamingFixture.submitTurn).toHaveBeenCalledTimes(1);

    // Step 2: Turn generation completes, turnCount goes to 1
    gameDoc.turnCount = 1;
    streamingFixture.isStreaming = false;
    streamingFixture.segments = [
      makeDisplaySegment(0, 'The airlock hisses open.'),
      makeDisplaySegment(1, 'Emergency lighting bathes everything in red.'),
    ];
    view.rerender(
      <GameplayScreen
        gameId="j9733s5p0przppv68h942xqd6n81nxmb"
        stationId="k179vww2j4ets2zbf4nacbg8sx81n06m"
        onGameOver={vi.fn()}
        onRunSummary={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    // Step 3: Modal STILL open, segments NOT yet pushed
    expect(mocks.lastMissionModalOnClose).not.toBeNull();
    expect(mocks.twPushSegmentMock).not.toHaveBeenCalled();

    // Step 4: User dismisses the mission modal
    act(() => { mocks.lastMissionModalOnClose?.(); });

    // Step 5: Segments now flow to typewriter
    expect(mocks.twPushSegmentMock).toHaveBeenCalled();
    expect(mocks.typewriterPushCalls.length).toBeGreaterThanOrEqual(2);
  });
});
