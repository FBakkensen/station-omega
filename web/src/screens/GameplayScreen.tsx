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
import { SituationModal } from '../components/modals/SituationModal';
import { usePreferences } from '../hooks/usePreferences';
import { useDevSettings } from '../hooks/useDevSettings';
import { useGameImages } from '../hooks/useStationImages';
import { ErrorBoundary } from '../components/ErrorBoundary';
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
  onQuit: () => void;
}

export function GameplayScreen({ gameId, stationId, onGameOver, onRunSummary, onQuit }: GameplayScreenProps) {
  const game = useQuery(api.games.get, { id: gameId as Id<"games"> }) as ConvexGameDoc | null | undefined;
  const station = useQuery(api.stations.get, { id: stationId as Id<"stations"> }) as ConvexStationDoc | null | undefined;

  const [showMap, setShowMap] = useState(false);
  const [showMission, setShowMission] = useState(false);
  const [dismissedInitialBriefing, setDismissedInitialBriefing] = useState(false);
  const [showSituation, setShowSituation] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  const status = extractGameStatus(game, station);
  const stationName = station?.stationName ?? 'Station Omega';
  const stationData = station?.data ?? null;
  const missionElapsedMinutes = game?.state?.missionElapsedMinutes ?? 0;

  const { gameMasterModelId, soundEnabled: initialSound, setSoundEnabled: persistSound } = usePreferences();
  const stationImages = useGameImages(gameId, stationId);

  const streaming = useStreamingTurn({
    gameId,
    stationData,
    missionElapsedMinutes,
    modelId: gameMasterModelId,
  });

  // Destructure stable properties from streaming to use in effect deps
  const {
    segments, latestTurnStartIndex, isStreaming,
    submitTurn, choices, choiceTitle, error: streamError, clearError,
  } = streaming;

  // TTS proxy URL: derive from Convex URL (.cloud → .site) + /api/tts
  const ttsProxyUrl = useMemo(() => {
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (!convexUrl) return null;
    return convexUrl.replace('.cloud', '.site') + '/api/tts';
  }, []);
  const ttsAvailable = ttsProxyUrl !== null;
  const devSettings = useDevSettings();
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
  // Initial hydration gate: existing persisted segments should render as already-finalized.
  const hasHydratedInitialSnapshotRef = useRef(false);
  // Tracks whether a live stream started after mount (user submitted in this session).
  const hasObservedPostMountLiveStreamRef = useRef(false);
  // Distinguishes initial mount from later transitions.
  const hasSeenInitialStreamingStateRef = useRef(false);
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

  // Capture the initial turnCount once the game doc first loads.
  // Uses the React "store information from previous renders" pattern
  // (setState during render) to lock in the value without effects or refs.
  const [capturedInitialTurnCount, setCapturedInitialTurnCount] = useState<number | undefined>(undefined);
  if (game && capturedInitialTurnCount === undefined) {
    setCapturedInitialTurnCount(game.turnCount);
  }
  const showInitialBriefing = !dismissedInitialBriefing && capturedInitialTurnCount === 0;
  const missionVisible = showMission || showInitialBriefing;

  // Auto-submit the first turn when game loads (initial "look around").
  // Fires immediately — generation runs in the background while the mission briefing is shown.
  const firstTurnSentRef = useRef(false);
  useEffect(() => {
    if (!game || !station || firstTurnSentRef.current) return;
    if (game.turnCount !== 0) return;
    if (segments.length === 0 && !isStreaming) {
      firstTurnSentRef.current = true;
      void submitTurn('I look around and take in my surroundings.');
    }
  }, [game, station, segments.length, isStreaming, submitTurn]);

  // Synchronous dismiss handler: plays accumulated segments inline in the event
  // handler instead of relying on effects. Immune to React strict mode and
  // effect ordering issues.
  const dismissBriefing = useCallback(() => {
    if (showInitialBriefing && segments.length > 0) {
      if (ttsEnabledRef.current) {
        ttsRef.current.beginStream();
        ttsHighWaterRef.current = -1;
      }

      for (const seg of segments) {
        const immediate = seg.type === 'player_action';
        const bodyChars = twPushSegment(seg, immediate);
        if (ttsEnabledRef.current && bodyChars > 0 && !immediate) {
          ttsHighWaterRef.current = seg.segmentIndex;
          ttsRef.current.pushSegment(seg, bodyChars);
        }
      }

      if (!isStreaming && ttsEnabledRef.current) {
        ttsRef.current.flushStream();
      }

      // Set refs so effects don't re-process these segments
      hasHydratedInitialSnapshotRef.current = true;
      hasObservedPostMountLiveStreamRef.current = true;
      hasSeenInitialStreamingStateRef.current = true;
    } else if (showInitialBriefing) {
      hasSeenInitialStreamingStateRef.current = true;
    }

    setDismissedInitialBriefing(true);
    setShowMission(false);
  }, [showInitialBriefing, segments, isStreaming, twPushSegment]);

  // Ref for Escape key handler (avoids stale closure)
  const dismissBriefingRef = useRef(dismissBriefing);
  useEffect(() => { dismissBriefingRef.current = dismissBriefing; });

  // Stream lifecycle: finalize previous cards on turn start, flush TTS on turn end.
  // IMPORTANT: This effect MUST be declared before the segment push effect so that
  // React fires it first when both deps change in the same render. This ensures
  // twFinalizeAll() + beginStream() run before new segments are pushed.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (showInitialBriefing) {
      prevStreamingRef.current = isStreaming;
      return;
    }

    if (!hasSeenInitialStreamingStateRef.current) {
      hasSeenInitialStreamingStateRef.current = true;
    } else if (isStreaming && !prevStreamingRef.current) {
      hasObservedPostMountLiveStreamRef.current = true;
    }

    if (isStreaming && !prevStreamingRef.current) {
      twFinalizeAll();
      if (ttsEnabledRef.current) {
        ttsRef.current.beginStream();
        ttsHighWaterRef.current = -1;
      }
    } else if (!isStreaming && prevStreamingRef.current) {
      if (ttsEnabledRef.current) {
        ttsRef.current.flushStream();
      }
    }

    prevStreamingRef.current = isStreaming;
  }, [isStreaming, twFinalizeAll, showInitialBriefing]);

  // Push new segments to typewriter + TTS as they arrive.
  // Historical segments (before latestTurnStartIndex) are pushed as immediate (no typewriter).
  // Uses ttsHighWaterRef + latestTurnStartIndex to only push current turn to TTS.
  useEffect(() => {
    // Suppress while the initial mission briefing is visible — segments accumulate
    // in Convex but aren't pushed to typewriter/TTS until the user dismisses the modal.
    if (showInitialBriefing) {
      return;
    }

    const shouldHydrateInitialSnapshot =
      !hasHydratedInitialSnapshotRef.current
      && !hasObservedPostMountLiveStreamRef.current;

    let hydratedAnySegment = false;
    let maxHydratedSegmentIndex = ttsHighWaterRef.current;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isHistorical = i < latestTurnStartIndex;
      const immediate = shouldHydrateInitialSnapshot || isHistorical || seg.type === 'player_action';
      const bodyChars = twPushSegment(seg, immediate);

      if (shouldHydrateInitialSnapshot) {
        hydratedAnySegment = true;
        maxHydratedSegmentIndex = Math.max(maxHydratedSegmentIndex, seg.segmentIndex);
      }

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

    if (shouldHydrateInitialSnapshot && hydratedAnySegment) {
      hasHydratedInitialSnapshotRef.current = true;
      ttsHighWaterRef.current = Math.max(ttsHighWaterRef.current, maxHydratedSegmentIndex);
    }
  }, [segments, latestTurnStartIndex, twPushSegment, showInitialBriefing]);

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
      } else if (e.key === 'F3') {
        e.preventDefault();
        setShowMap(false);
        setShowMission(false);
        setShowSituation((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowMap(false);
        dismissBriefingRef.current();
        setShowSituation(false);
        setShowQuitConfirm(false);
      } else if (e.key === 'F10') {
        e.preventDefault();
        setShowQuitConfirm((prev) => !prev);
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
    <div className="flex flex-col h-full">
      {/* Toolbar — full width */}
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
          <span>•</span>
          <button
            onClick={() => { setShowMap(false); setShowMission(false); setShowSituation(true); }}
            className="hover:text-omega-text transition-colors"
          >
            [F3] Status
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
          <button
            onClick={() => { setShowQuitConfirm(true); }}
            className="ml-auto hover:text-omega-text transition-colors"
          >
            [F10] Quit
          </button>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Narrative Panel + Command Input */}
        <div className="flex-1 flex flex-col min-h-0">

        <ErrorBoundary>
          <NarrativePanel
            segments={showInitialBriefing ? [] : segments}
            typewriterCards={twCards}
            choices={showInitialBriefing ? null : choices}
            choiceTitle={showInitialBriefing ? null : choiceTitle}
            onChoice={handleChoice}
            isStreaming={isStreaming}
            allFinalized={twAllFinalized}
            stationImages={stationImages}
          />
        </ErrorBoundary>

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
        <Sidebar status={status} stationName={stationName} stationImages={stationImages} currentRoomId={currentRoomId} />
      </div>

      {/* Modals */}
      {showMap && mapRooms && (
        <MapModal
          rooms={mapRooms}
          currentRoomId={currentRoomId}
          visitedRoomIds={visitedRoomIds}
          onClose={() => { setShowMap(false); }}
        />
      )}

      {missionVisible && status && (
        <MissionModal
          title={status.objectiveTitle}
          steps={status.objectiveSteps}
          currentStepIndex={status.objectiveStep - 1}
          isComplete={status.objectivesComplete}
          onClose={dismissBriefing}
          videoUrl={stationImages.get('briefing_video')?.url}
          muted={!ttsEnabled}
        />
      )}

      {showSituation && (
        <SituationModal
          status={status}
          onClose={() => { setShowSituation(false); }}
        />
      )}

      {showQuitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => { setShowQuitConfirm(false); }}
        >
          <div
            className="border border-omega-border bg-omega-panel max-w-sm w-full mx-4 p-6"
            onClick={(e) => { e.stopPropagation(); }}
          >
            <h2 className="text-omega-title text-sm uppercase tracking-wider mb-4">Quit Game?</h2>
            <p className="text-omega-dim text-sm mb-6">Return to the main screen?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowQuitConfirm(false); }}
                className="px-4 py-2 text-xs text-omega-dim hover:text-omega-text transition-colors"
              >
                Stay
              </button>
              <button
                onClick={() => { onQuit(); }}
                className="px-4 py-2 text-xs bg-red-900/50 border border-red-700 text-red-300 hover:bg-red-900/70 transition-colors"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
