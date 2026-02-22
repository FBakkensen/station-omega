import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Sidebar } from '../components/sidebar/Sidebar';
import { NarrativePanel } from '../components/narrative/NarrativePanel';
import { CommandInput } from '../components/input/CommandInput';
import { useStreamingTurn } from '../hooks/useStreamingTurn';
import { useTypewriter } from '../hooks/useTypewriter';
import { useTTS } from '../hooks/useTTS';
import { MapModal } from '../components/modals/MapModal';
import { MissionModal } from '../components/modals/MissionModal';
import { usePreferences } from '../hooks/usePreferences';
import { useDevSettings } from '../hooks/useDevSettings';
import {
  extractGameStatus,
  type ConvexGameDoc,
  type ConvexStationDoc,
} from './gameplay-status';

// ─── GameplayScreen ──────────────────────────────────────────────────────

interface GameplayScreenProps {
  gameId: string;
  stationId: string;
  onGameOver: (gameId: string) => void;
  onRunSummary: (gameId: string) => void;
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
  const devSettings = useDevSettings();
  const { soundEnabled: initialSound, setSoundEnabled: persistSound } = usePreferences();
  const [userSoundEnabled, setUserSoundEnabled] = useState(initialSound);
  const ttsEnabled = ttsAvailable && !devSettings.forceMute && userSoundEnabled;

  const typewriter = useTypewriter(ttsEnabled, devSettings.typewriterCharsPerSec);

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
  const prevForceMuteRef = useRef(devSettings.forceMute);
  useEffect(() => {
    ttsRef.current = tts;
    ttsEnabledRef.current = ttsEnabled;
  });
  useEffect(() => {
    if (devSettings.forceMute && !prevForceMuteRef.current) {
      ttsRef.current.stop();
      twFinalizeAll();
    }
    prevForceMuteRef.current = devSettings.forceMute;
  }, [devSettings.forceMute, twFinalizeAll]);

  // Auto-submit the first turn when game loads (initial "look around")
  const firstTurnSentRef = useRef(false);
  useEffect(() => {
    if (!game || !station || firstTurnSentRef.current) return;
    if (game.turnCount !== 0) return;
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
          {devSettings.enabled && (
            <>
              <span>•</span>
              <span className="text-omega-title">DEV FAST · MUTE</span>
            </>
          )}
          {ttsAvailable && (
            <>
              <span>•</span>
              {devSettings.forceMute ? (
                <span className="text-omega-dim">Voice: FORCED OFF</span>
              ) : (
                <button
                  onClick={() => {
                    setUserSoundEnabled(prev => {
                      const next = !prev;
                      if (!next) {
                        // Turning OFF → stop TTS, reveal all text immediately
                        tts.stop();
                        twFinalizeAll();
                      }
                      persistSound(next);
                      return next;
                    });
                  }}
                  className={`transition-colors ${ttsEnabled ? 'text-omega-title' : 'hover:text-omega-text'}`}
                >
                  {ttsEnabled ? 'Voice: ON' : 'Voice: OFF'}
                </button>
              )}
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
