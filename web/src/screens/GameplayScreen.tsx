import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Sidebar } from '../components/sidebar/Sidebar';
import type { GameStatusData } from '../components/sidebar/Sidebar';
import { NarrativePanel } from '../components/narrative/NarrativePanel';
import { CommandInput } from '../components/input/CommandInput';
import { useStreamingTurn } from '../hooks/useStreamingTurn';
import { useTypewriter } from '../hooks/useTypewriter';
import { useTTS } from '../hooks/useTTS';
import { MapModal } from '../components/modals/MapModal';
import { MissionModal } from '../components/modals/MissionModal';
import { usePreferences } from '../hooks/usePreferences';

// ─── Convex document shapes (game.state and station.data are v.any()) ────

/** Loose shape of the game document from Convex. */
interface ConvexGameDoc {
  state?: {
    hp: number;
    maxHp: number;
    oxygen: number;
    maxOxygen: number;
    suitIntegrity: number;
    characterClass: string;
    missionElapsedMinutes: number;
    currentRoom: string;
    roomsVisited: string[];
    inventory: string[];
    maxInventory: number;
    activeEvents: Array<{ type: string; minutesRemaining: number; effect: string }>;
    metrics?: Record<string, unknown>;
  };
  objectivesOverride?: {
    title: string;
    steps: Array<{ description: string; completed: boolean }>;
    currentStepIndex: number;
    completed: boolean;
  };
  isOver: boolean;
  won: boolean;
  turnCount: number;
  characterClass: string;
  difficulty: string;
}

interface ConvexStationDoc {
  stationName: string;
  data?: {
    rooms?: Record<string, {
      id: string;
      name: string;
      archetype: string;
      connections: string[];
      depth: number;
      systemFailures?: Array<{
        systemId: string;
        status: string;
        challengeState: string;
        severity: number;
        minutesUntilCascade: number;
      }>;
    }>;
    items?: Record<string, { name: string; isKeyItem?: boolean }>;
    npcs?: Record<string, { name: string }>;
    crewRoster?: Array<{ name: string; role: string }>;
    arrivalScenario?: { playerCallsign?: string };
    objectives?: {
      title: string;
      steps: Array<{ description: string; completed: boolean }>;
      currentStepIndex: number;
      completed: boolean;
    };
  };
}

// ─── GameplayScreen ──────────────────────────────────────────────────────

interface GameplayScreenProps {
  gameId: string;
  stationId: string;
  onGameOver: (gameId: string) => void;
  onRunSummary: (gameId: string) => void;
}

/**
 * Extract sidebar-compatible status data from the raw Convex game + station docs.
 */
function extractGameStatus(
  game: ConvexGameDoc | null | undefined,
  station: ConvexStationDoc | null | undefined,
): GameStatusData | null {
  if (!game?.state || !station?.data) return null;

  const state = game.state;
  const sData = station.data;
  const rooms = sData.rooms;
  const currentRoom = rooms?.[state.currentRoom];
  const roomName = currentRoom?.name ?? state.currentRoom;
  const roomIds = Object.keys(rooms ?? {});
  const roomIndex = roomIds.indexOf(state.currentRoom) + 1;
  const totalRooms = roomIds.length;

  const inventory = state.inventory.map((id) => {
    const item = sData.items?.[id];
    return item?.name ?? id;
  });

  const inventoryKeyFlags = state.inventory.map((id) => {
    const item = sData.items?.[id];
    return item?.isKeyItem ?? false;
  });

  const systemFailures = (currentRoom?.systemFailures ?? []).map((f) => ({
    systemId: f.systemId,
    status: f.status,
    challengeState: f.challengeState,
    severity: f.severity,
    minutesUntilCascade: f.minutesUntilCascade,
  }));

  const objectives = game.objectivesOverride ?? sData.objectives;
  const steps = objectives?.steps ?? [];
  const currentStepIndex = objectives?.currentStepIndex ?? 0;

  return {
    hp: state.hp,
    maxHp: state.maxHp,
    oxygen: state.oxygen,
    maxOxygen: state.maxOxygen,
    suitIntegrity: state.suitIntegrity,
    characterClass: state.characterClass,
    missionElapsedMinutes: state.missionElapsedMinutes,
    roomName,
    roomIndex,
    totalRooms,
    inventory,
    inventoryKeyFlags,
    maxInventory: state.maxInventory,
    activeEvents: state.activeEvents,
    objectiveTitle: objectives?.title ?? 'Unknown',
    objectiveStep: currentStepIndex + 1,
    objectiveTotal: steps.length,
    objectiveCurrentDesc: steps[currentStepIndex]?.description ?? '',
    objectivesComplete: objectives?.completed ?? false,
    objectiveSteps: steps.map((s) => ({
      description: s.description,
      completed: s.completed,
    })),
    systemFailures,
    environment: null,
  };
}

export function GameplayScreen({ gameId, stationId, onGameOver, onRunSummary }: GameplayScreenProps) {
  const game = useQuery(api.games.get, { id: gameId as Id<"games"> }) as ConvexGameDoc | null | undefined;
  const station = useQuery(api.stations.get, { id: stationId as Id<"stations"> }) as ConvexStationDoc | null | undefined;

  const [showMap, setShowMap] = useState(false);
  const [showMission, setShowMission] = useState(false);

  const status = extractGameStatus(game, station);
  const stationName = station?.stationName ?? 'Station Omega';
  const stationData = station?.data ?? null;
  const missionElapsedMinutes = game?.state?.missionElapsedMinutes ?? 0;

  const streaming = useStreamingTurn({
    gameId,
    stationData,
    missionElapsedMinutes,
  });

  // Destructure stable properties from streaming to use in effect deps
  const {
    segments, latestTurnStartIndex, isStreaming,
    submitTurn, choices, error: streamError, clearError,
  } = streaming;

  // TTS proxy URL: derive from Convex URL (.cloud → .site) + /api/tts
  const ttsProxyUrl = useMemo(() => {
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (!convexUrl) return null;
    return convexUrl.replace('.cloud', '.site') + '/api/tts';
  }, []);
  const ttsAvailable = ttsProxyUrl !== null;
  const { soundEnabled: initialSound, setSoundEnabled: persistSound } = usePreferences();
  const [ttsEnabled, setTtsEnabled] = useState(initialSound);

  const typewriter = useTypewriter(ttsEnabled);

  // Destructure stable properties from typewriter to use in effect deps
  const {
    cards: twCards, pushSegment: twPushSegment,
    onRevealChunk: twOnRevealChunk, finalizeAll: twFinalizeAll,
    skipCurrent: twSkipCurrent, allFinalized: twAllFinalized,
  } = typewriter;

  const tts = useTTS(ttsProxyUrl, ttsEnabled, twOnRevealChunk, twFinalizeAll);

  // High-water mark: highest segmentIndex already pushed to TTS
  const ttsHighWaterRef = useRef(-1);
  // Stable refs for use inside effects without adding to deps
  const ttsRef = useRef(tts);
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    ttsRef.current = tts;
    ttsEnabledRef.current = ttsEnabled;
  });

  // Auto-submit the first turn when game loads (like the terminal game's initial "look around")
  const firstTurnSentRef = useRef(false);
  useEffect(() => {
    if (!game || !station || firstTurnSentRef.current) return;
    if (segments.length === 0 && !isStreaming) {
      firstTurnSentRef.current = true;
      void submitTurn('I look around and take in my surroundings.');
    }
  }, [game, station, segments.length, isStreaming, submitTurn]);

  // Stream lifecycle: finalize previous cards on turn start, flush TTS on turn end.
  // IMPORTANT: This effect MUST be declared before the segment push effect so that
  // React fires it first when both deps change in the same render. This ensures
  // twFinalizeAll() + beginStream() run before new segments are pushed.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // Turn just started — finalize any lingering cards from previous turn
      twFinalizeAll();
      if (ttsEnabledRef.current) {
        ttsRef.current.beginStream();
        ttsHighWaterRef.current = -1; // Reset for new turn
      }
    } else if (!isStreaming && prevStreamingRef.current) {
      // Turn just ended — let typewriter finish naturally (no finalizeAll)
      if (ttsEnabledRef.current) {
        ttsRef.current.flushStream();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, twFinalizeAll]);

  // Push new segments to typewriter + TTS as they arrive.
  // Historical segments (before latestTurnStartIndex) are pushed as immediate (no typewriter).
  // Uses ttsHighWaterRef + latestTurnStartIndex to only push current turn to TTS.
  useEffect(() => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isHistorical = i < latestTurnStartIndex;
      const immediate = isHistorical || seg.type === 'player_action';
      const bodyChars = twPushSegment(seg, immediate);

      // Only push new segments from the latest turn to TTS
      if (
        ttsEnabledRef.current &&
        seg.segmentIndex > ttsHighWaterRef.current &&
        !immediate &&
        bodyChars > 0
      ) {
        ttsHighWaterRef.current = seg.segmentIndex;
        ttsRef.current.pushSegment(seg, bodyChars);
      }
    }
  }, [segments, latestTurnStartIndex, twPushSegment]);

  // Detect game over — wait for typewriter to finish before transitioning
  const gameIsOver = game?.isOver;
  const gameWon = game?.won;
  useEffect(() => {
    if (!gameIsOver || isStreaming || !twAllFinalized) return;
    const timer = setTimeout(() => {
      if (gameWon) {
        onRunSummary(gameId);
      } else {
        onGameOver(gameId);
      }
    }, 2000);
    return () => { clearTimeout(timer); };
  }, [gameIsOver, gameWon, isStreaming, twAllFinalized, gameId, onGameOver, onRunSummary]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShowMap((prev) => !prev);
      } else if (e.key === 'F2') {
        e.preventDefault();
        setShowMission((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowMap(false);
        setShowMission(false);
      } else if (e.key === ' ') {
        // Spacebar skips current typewriter card (only when input not focused)
        const active = document.activeElement;
        const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        if (!isInput) {
          e.preventDefault();
          twSkipCurrent();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [twSkipCurrent]);

  const handleSubmit = useCallback((input: string) => {
    void submitTurn(input);
  }, [submitTurn]);

  const handleChoice = useCallback((choiceId: string) => {
    const choice = choices?.find(c => c.id === choiceId);
    if (choice) {
      void submitTurn(choice.label);
    }
  }, [choices, submitTurn]);

  // Map modal data
  const mapRooms = stationData?.rooms ?? null;
  const currentRoomId = game?.state?.currentRoom ?? '';
  const visitedRoomIds = game?.state?.roomsVisited ?? [];

  return (
    <div className="flex h-full">
      {/* Narrative Panel + Command Input */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-omega-border bg-omega-panel text-xs text-omega-dim">
          <button
            onClick={() => { setShowMap(true); }}
            className="hover:text-omega-text transition-colors"
          >
            [F1] Map
          </button>
          <span>•</span>
          <button
            onClick={() => { setShowMission(true); }}
            className="hover:text-omega-text transition-colors"
          >
            [F2] Mission
          </button>
          {ttsAvailable && (
            <>
              <span>•</span>
              <button
                onClick={() => {
                  setTtsEnabled(prev => {
                    if (prev) {
                      // Turning OFF → stop TTS, reveal all text immediately
                      tts.stop();
                      twFinalizeAll();
                    }
                    persistSound(!prev);
                    return !prev;
                  });
                }}
                className={`transition-colors ${ttsEnabled ? 'text-omega-title' : 'hover:text-omega-text'}`}
              >
                {ttsEnabled ? 'Voice: ON' : 'Voice: OFF'}
              </button>
            </>
          )}
        </div>

        <NarrativePanel
          segments={segments}
          typewriterCards={twCards}
          choices={choices}
          onChoice={handleChoice}
          isStreaming={isStreaming}
          allFinalized={twAllFinalized}
        />

        {streamError && (
          <div className="px-4 py-2 bg-red-900/30 border-t border-red-700 text-red-300 text-xs">
            {streamError}
            <button
              onClick={clearError}
              className="ml-2 underline text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        <CommandInput
          onSubmit={handleSubmit}
          disabled={isStreaming || !twAllFinalized}
        />
      </div>

      {/* Sidebar */}
      <Sidebar status={status} stationName={stationName} />

      {/* Modals */}
      {showMap && mapRooms && (
        <MapModal
          rooms={mapRooms}
          currentRoomId={currentRoomId}
          visitedRoomIds={visitedRoomIds}
          onClose={() => { setShowMap(false); }}
        />
      )}

      {showMission && status && (
        <MissionModal
          title={status.objectiveTitle}
          steps={status.objectiveSteps}
          currentStepIndex={status.objectiveStep - 1}
          isComplete={status.objectivesComplete}
          onClose={() => { setShowMission(false); }}
        />
      )}
    </div>
  );
}
