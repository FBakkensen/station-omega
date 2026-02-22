import { useReducer, useCallback, useMemo, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { resolveSegment } from '../engine/resolveSegment';
import type { DisplaySegment, Choice } from '../engine/types';

interface StationData {
  npcs?: Record<string, { name: string }>;
  crewRoster?: Array<{ name: string; role: string }>;
  arrivalScenario?: { playerCallsign?: string };
}

interface TurnState {
  /** Turn currently being streamed (null if idle). */
  activeTurnNumber: number | null;
  /** Error from the last turn, if any. */
  error: string | null;
}

type TurnAction =
  | { type: 'START_TURN'; turnNumber: number }
  | { type: 'END_TURN' }
  | { type: 'ERROR'; error: string }
  | { type: 'CLEAR_ERROR' };

function turnReducer(state: TurnState, action: TurnAction): TurnState {
  switch (action.type) {
    case 'START_TURN':
      return { ...state, activeTurnNumber: action.turnNumber, error: null };
    case 'END_TURN':
      return { ...state, activeTurnNumber: null };
    case 'ERROR':
      return { ...state, activeTurnNumber: null, error: action.error };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
  }
}

const initialState: TurnState = {
  activeTurnNumber: null,
  error: null,
};

interface UseStreamingTurnOptions {
  gameId: string;
  stationData: StationData | null;
  missionElapsedMinutes: number;
}

export function useStreamingTurn({
  gameId,
  stationData,
  missionElapsedMinutes,
}: UseStreamingTurnOptions) {
  console.log('[useStreamingTurn] hook called, gameId:', gameId);
  const [state, dispatch] = useReducer(turnReducer, initialState);
  const hasObservedProcessingForActiveTurnRef = useRef(false);
  const previousIsProcessingRef = useRef<boolean | undefined>(undefined);
  const startTurnMutation = useMutation(api.turns.start);

  // Subscribe to segments for this game (all turns)
  const rawSegments = useQuery(api.turnSegments.listAllForGame, {
    gameId: gameId as Id<"games">,
  });

  // Subscribe to turn processing status
  const isProcessing = useQuery(api.turns.isProcessing, {
    gameId: gameId as Id<"games">,
  });

  // Subscribe to current choices
  const rawChoices = useQuery(api.choiceSets.getCurrent, {
    gameId: gameId as Id<"games">,
  });

  console.log('[useStreamingTurn] rawSegments:', rawSegments?.length, 'isProcessing:', isProcessing, 'rawChoices:', rawChoices);

  // Resolve raw segments into DisplaySegments
  const segments: DisplaySegment[] = useMemo(() => {
    if (!rawSegments) return [];
    return rawSegments.map(
      (
        doc: { segmentIndex: number; segment: { type: string; text: string; npcId: string | null; crewName: string | null } },
        i: number,
      ) =>
        resolveSegment(
          {
            type: doc.segment.type as DisplaySegment['type'],
            text: doc.segment.text,
            npcId: doc.segment.npcId,
            crewName: doc.segment.crewName,
          },
          i,
          stationData,
          missionElapsedMinutes,
        ),
    );
  }, [rawSegments, stationData, missionElapsedMinutes]);

  // Index of the first segment in the latest (most recent) turn.
  // Used to avoid re-pushing historical segments to TTS on each render.
  const latestTurnStartIndex = useMemo(() => {
    if (!rawSegments || rawSegments.length === 0) return 0;
    const lastTurnNumber = (rawSegments[rawSegments.length - 1] as { turnNumber: number }).turnNumber;
    const firstOfTurn = rawSegments.findIndex(
      (d: { turnNumber: number }) => d.turnNumber === lastTurnNumber,
    );
    return firstOfTurn >= 0 ? firstOfTurn : 0;
  }, [rawSegments]);

  // Map choices
  const choices: Choice[] | null = useMemo(() => {
    if (!rawChoices?.choices) return null;
    return (rawChoices.choices as Array<{ id: string; label: string; description: string }>);
  }, [rawChoices]);

  const hasSegmentsForActiveTurn = useMemo(() => {
    if (state.activeTurnNumber === null || !rawSegments || rawSegments.length === 0) {
      return false;
    }

    return rawSegments.some(
      (doc: { turnNumber: number }) => doc.turnNumber === state.activeTurnNumber,
    );
  }, [state.activeTurnNumber, rawSegments]);

  const isStreaming = isProcessing === true || state.activeTurnNumber !== null;

  const submitTurn = useCallback(async (playerInput: string) => {
    console.log('[useStreamingTurn] submitTurn called, input:', playerInput, 'isStreaming:', isStreaming);
    if (isStreaming) {
      console.warn('[useStreamingTurn] already streaming, ignoring');
      return;
    }

    try {
      console.log('[useStreamingTurn] calling turns.start mutation...');
      const result = await startTurnMutation({
        gameId: gameId as Id<"games">,
        playerInput,
      });

      console.log('[useStreamingTurn] turns.start result:', result);
      if (result.ok) {
        hasObservedProcessingForActiveTurnRef.current = false;
        dispatch({ type: 'START_TURN', turnNumber: result.turnNumber });
      } else {
        console.error('[useStreamingTurn] turn start failed:', result.error);
        dispatch({ type: 'ERROR', error: result.error });
      }
    } catch (err) {
      console.error('[useStreamingTurn] submitTurn error:', err);
      dispatch({
        type: 'ERROR',
        error: err instanceof Error ? err.message : 'Failed to start turn',
      });
    }
  }, [isStreaming, startTurnMutation, gameId]);

  // Auto-detect when processing finishes
  useEffect(() => {
    const previousIsProcessing = previousIsProcessingRef.current;
    previousIsProcessingRef.current = isProcessing;

    if (state.activeTurnNumber === null) {
      hasObservedProcessingForActiveTurnRef.current = false;
      return;
    }

    if (isProcessing === true) {
      hasObservedProcessingForActiveTurnRef.current = true;
      return;
    }

    if (
      isProcessing === false
      && (
        hasObservedProcessingForActiveTurnRef.current
        || hasSegmentsForActiveTurn
        // Convex queries can transiently report undefined while loading and then
        // settle directly to false for very fast turns. Handle that completion
        // path even when no segments were persisted for the active turn.
        || previousIsProcessing === undefined
      )
    ) {
      hasObservedProcessingForActiveTurnRef.current = false;
      dispatch({ type: 'END_TURN' });
    }
  }, [state.activeTurnNumber, isProcessing, hasSegmentsForActiveTurn]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  return {
    segments,
    choices,
    isStreaming,
    latestTurnStartIndex,
    error: state.error,
    submitTurn,
    clearError,
  };
}
