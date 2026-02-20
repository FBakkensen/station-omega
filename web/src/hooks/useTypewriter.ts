import { useRef, useCallback, useEffect, useState } from 'react';
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
const DEFAULT_CHARS_PER_SEC = 30;

export interface TypewriterCard {
  spans: StyledSpan[];
  revealedChars: number;
  headerChars: number;
  finalized: boolean;
}

export interface UseTypewriterResult {
  /** Map of segmentIndex -> reveal state for rendering. */
  cards: Map<number, TypewriterCard>;
  /** Push a new segment to start revealing. */
  pushSegment: (segment: DisplaySegment) => void;
  /** TTS callback: allow more characters on a specific card. */
  onRevealChunk: (segmentIndex: number, charBudget: number, durationSec: number) => void;
  /** Instantly reveal all remaining text on all cards. */
  finalizeAll: () => void;
  /** Finalize a single segment (e.g. when TTS completes it). */
  finalizeSegment: (segmentIndex: number) => void;
  /** Skip the current card's animation (reveal fully). */
  skipCurrent: () => void;
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
 * Typewriter reveal hook using requestAnimationFrame.
 *
 * Each segment gets its own card with independent reveal state.
 * Header spans are always fully revealed. Body text reveals gradually.
 * Without TTS, auto-advances at DEFAULT_CHARS_PER_SEC.
 * With TTS, onRevealChunk() gates the character budget to match speech timing.
 */
export function useTypewriter(ttsEnabled = false): UseTypewriterResult {
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

      for (const card of cardsRef.current.values()) {
        if (card.finalized) continue;

        // Clamp dt to avoid jumps on tab switch
        const clampedDt = Math.min(dt, 0.1);
        const charsToAdd = card.revealRate * clampedDt;
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
        } else {
          anyActive = true;
        }
      }

      syncSnapshot();

      if (anyActive) {
        animFrameRef.current = requestAnimationFrame(() => { tickRef.current(); });
      } else {
        animFrameRef.current = 0;
      }
    };
  }, [syncSnapshot]);

  // Start the animation loop if not running
  const ensureRunning = useCallback(() => {
    if (animFrameRef.current === 0) {
      lastFrameRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(() => { tickRef.current(); });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, []);

  const pushSegment = useCallback((segment: DisplaySegment) => {
    const map = cardsRef.current;
    if (map.has(segment.segmentIndex)) return; // Already tracked

    const { spans, headerCharCount } = segmentToStyledSpans(segment);
    const totalChars = countSpanChars(spans);
    const headerChars = headerCharCount;

    const card: CardRevealState = {
      spans,
      totalChars,
      headerChars,
      revealedChars: headerChars, // Header always revealed
      revealAllowedChars: ttsEnabled ? headerChars : totalChars, // TTS gates body; no TTS = all allowed
      revealRate: DEFAULT_CHARS_PER_SEC,
      finalized: false,
    };

    map.set(segment.segmentIndex, card);
    syncSnapshot();
    ensureRunning();
  }, [ttsEnabled, ensureRunning, syncSnapshot]);

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
      cancelAnimationFrame(animFrameRef.current);
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
    // Skip the last non-finalized card
    const entries = [...cardsRef.current.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const card = entries[i][1];
      if (!card.finalized) {
        card.revealedChars = card.totalChars;
        card.revealAllowedChars = card.totalChars;
        card.finalized = true;
        break;
      }
    }
    syncSnapshot();
  }, [syncSnapshot]);

  return {
    cards,
    pushSegment,
    onRevealChunk,
    finalizeAll,
    finalizeSegment,
    skipCurrent,
  };
}
