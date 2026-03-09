import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import type { DisplaySegment, StyledSpan } from '../engine/types';
import { segmentToStyledSpans, countSpanChars } from '../engine/segmentStyles';

/**
 * Per-card reveal state, tracked by segmentIndex.
 * The typewriter reveals characters at a steady rate, optionally gated by TTS chunks.
 */
interface CardRevealState {
  /** All styled spans for this segment (header + body). */
  spans: StyledSpan[];
  /** Total character count across all spans. */
  totalChars: number;
  /** Number of header characters (always fully revealed). */
  headerChars: number;
  /** How many characters are currently revealed. */
  revealedChars: number;
  /** Max characters the typewriter is allowed to reveal (gated by TTS or auto). */
  revealAllowedChars: number;
  /** Characters per second rate. */
  revealRate: number;
  /** Whether this card is fully revealed. */
  finalized: boolean;
}

/** Default reveal speed in characters per second (when no TTS). */
const DEFAULT_CHARS_PER_SEC = 20;

export interface TypewriterCard {
  spans: StyledSpan[];
  revealedChars: number;
  headerChars: number;
  finalized: boolean;
}

interface UseTypewriterResult {
  /** Map of segmentIndex -> reveal state for rendering. */
  cards: Map<number, TypewriterCard>;
  /** Push a new segment to start revealing. If immediate=true, card is created already finalized.
   *  Returns the number of body characters (total minus header), or -1 if the segment was already tracked or immediate. */
  pushSegment: (segment: DisplaySegment, immediate?: boolean) => number;
  /** TTS callback: allow more characters on a specific card. */
  onRevealChunk: (segmentIndex: number, charBudget: number, durationSec: number) => void;
  /** Instantly reveal all remaining text on all cards. */
  finalizeAll: () => void;
  /** Finalize a single segment (e.g. when TTS completes it). */
  finalizeSegment: (segmentIndex: number) => void;
  /** Skip the currently-revealing card's animation (reveal fully). */
  skipCurrent: () => void;
  /** True when all pushed cards are finalized (or no cards exist). */
  allFinalized: boolean;
}

/** Build a public snapshot Map from the mutable card ref. */
function snapshotCards(source: Map<number, CardRevealState>): Map<number, TypewriterCard> {
  const snapshot = new Map<number, TypewriterCard>();
  for (const [idx, card] of source) {
    snapshot.set(idx, {
      spans: card.spans,
      revealedChars: Math.floor(card.revealedChars),
      headerChars: card.headerChars,
      finalized: card.finalized,
    });
  }
  return snapshot;
}

/**
 * Typewriter reveal hook using setTimeout.
 *
 * Each segment gets its own card with independent reveal state.
 * Header spans are always fully revealed. Body text reveals gradually.
 * Without TTS, auto-advances at DEFAULT_CHARS_PER_SEC.
 * With TTS, onRevealChunk() gates the character budget to match speech timing.
 */
export function useTypewriter(
  ttsEnabled = false,
  charsPerSec = DEFAULT_CHARS_PER_SEC,
): UseTypewriterResult {
  const cardsRef = useRef<Map<number, CardRevealState>>(new Map());
  const lastFrameRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);
  const [cards, setCards] = useState<Map<number, TypewriterCard>>(() => new Map());

  // Use a ref for tick to avoid self-reference issues in useCallback
  const tickRef = useRef<() => void>(() => { /* initialized below */ });

  // Snapshot the mutable cards ref into React state
  const syncSnapshot = useCallback(() => {
    setCards(snapshotCards(cardsRef.current));
  }, []);

  // Keep tick closure up to date (inside useEffect, not during render)
  useEffect(() => {
    tickRef.current = () => {
      const now = performance.now();
      const dt = (now - lastFrameRef.current) / 1000; // seconds
      lastFrameRef.current = now;

      let anyActive = false;

      // Sequential reveal: only advance the FIRST non-finalized card
      for (const card of cardsRef.current.values()) {
        if (card.finalized) continue;

        const charsToAdd = card.revealRate * dt;
        const newRevealed = Math.min(
          card.revealedChars + charsToAdd,
          card.revealAllowedChars,
          card.totalChars,
        );

        if (newRevealed !== card.revealedChars) {
          card.revealedChars = newRevealed;
        }

        // Check if fully revealed
        if (card.revealedChars >= card.totalChars) {
          card.revealedChars = card.totalChars;
          card.finalized = true;
          // Card just finalized — continue to start the next one immediately
          continue;
        }

        // Card is still revealing — stop here (sequential)
        anyActive = true;
        break;
      }

      syncSnapshot();

      if (anyActive) {
        animFrameRef.current = window.setTimeout(() => { tickRef.current(); }, 16);
      } else {
        animFrameRef.current = 0;
      }
    };
  }, [syncSnapshot]);

  // Start the animation loop if not running
  const ensureRunning = useCallback(() => {
    if (animFrameRef.current === 0) {
      lastFrameRef.current = performance.now();
      animFrameRef.current = window.setTimeout(() => { tickRef.current(); }, 16);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== 0) {
        clearTimeout(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, []);

  const pushSegment = useCallback((segment: DisplaySegment, immediate?: boolean): number => {
    const map = cardsRef.current;
    if (map.has(segment.segmentIndex)) return -1; // Already tracked

    const { spans, headerCharCount } = segmentToStyledSpans(segment);
    const totalChars = countSpanChars(spans);
    const headerChars = headerCharCount;

    if (immediate) {
      // Already-finalized card (e.g. historical segments on page load)
      map.set(segment.segmentIndex, {
        spans,
        totalChars,
        headerChars,
        revealedChars: totalChars,
        revealAllowedChars: totalChars,
        revealRate: charsPerSec,
        finalized: true,
      });
      syncSnapshot();
      return -1;
    }

    const card: CardRevealState = {
      spans,
      totalChars,
      headerChars,
      revealedChars: headerChars, // Header always revealed
      revealAllowedChars: ttsEnabled ? headerChars : totalChars, // TTS gates body; no TTS = all allowed
      revealRate: charsPerSec,
      finalized: false,
    };

    map.set(segment.segmentIndex, card);
    syncSnapshot();
    ensureRunning();
    return Math.max(totalChars - headerChars, 0);
  }, [ttsEnabled, charsPerSec, ensureRunning, syncSnapshot]);

  const onRevealChunk = useCallback((segmentIndex: number, charBudget: number, durationSec: number) => {
    const card = cardsRef.current.get(segmentIndex);
    if (!card || card.finalized) return;

    card.revealAllowedChars = Math.min(
      card.revealAllowedChars + charBudget,
      card.totalChars,
    );

    if (durationSec > 0 && charBudget > 0) {
      card.revealRate = charBudget / durationSec;
    }

    ensureRunning();
  }, [ensureRunning]);

  const finalizeAll = useCallback(() => {
    for (const card of cardsRef.current.values()) {
      card.revealedChars = card.totalChars;
      card.revealAllowedChars = card.totalChars;
      card.finalized = true;
    }
    if (animFrameRef.current !== 0) {
      clearTimeout(animFrameRef.current);
      animFrameRef.current = 0;
    }
    syncSnapshot();
  }, [syncSnapshot]);

  const finalizeSegment = useCallback((segmentIndex: number) => {
    const card = cardsRef.current.get(segmentIndex);
    if (!card || card.finalized) return;
    card.revealedChars = card.totalChars;
    card.revealAllowedChars = card.totalChars;
    card.finalized = true;
    syncSnapshot();
  }, [syncSnapshot]);

  const skipCurrent = useCallback(() => {
    // Skip the first non-finalized card (the one currently revealing)
    for (const card of cardsRef.current.values()) {
      if (!card.finalized) {
        card.revealedChars = card.totalChars;
        card.revealAllowedChars = card.totalChars;
        card.finalized = true;
        break;
      }
    }
    syncSnapshot();
    ensureRunning(); // Kick the loop so the next card starts immediately
  }, [syncSnapshot, ensureRunning]);

  // Derive allFinalized from snapshot: true when every card is finalized (or no cards)
  const allFinalized = useMemo(() => {
    for (const card of cards.values()) {
      if (!card.finalized) return false;
    }
    return true;
  }, [cards]);

  return {
    cards,
    pushSegment,
    onRevealChunk,
    finalizeAll,
    finalizeSegment,
    skipCurrent,
    allFinalized,
  };
}
