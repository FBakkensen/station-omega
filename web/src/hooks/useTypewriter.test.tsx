import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypewriter } from './useTypewriter';
import { makeSegment } from './__test-support__/makeSegment';

vi.mock('../engine/segmentStyles', () => ({
  segmentToStyledSpans: (segment: { text: string }) => {
    const header = 'HEAD';
    return {
      spans: [{ text: header }, { text: segment.text }],
      headerCharCount: header.length,
    };
  },
  countSpanChars: (spans: Array<{ text: string }>) =>
    spans.reduce((total, span) => total + span.text.length, 0),
}));

describe('useTypewriter reveal contracts', () => {
  let nowMs: number;
  let rafId: number;
  let pendingTimers: Map<number, ReturnType<typeof setTimeout>>;

  const advance = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 0;
    rafId = 0;
    pendingTimers = new Map();

    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafId += 1;
      const id = rafId;
      const timer = setTimeout(() => {
        nowMs += 16;
        cb(nowMs);
      }, 16);
      pendingTimers.set(id, timer);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const timer = pendingTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        pendingTimers.delete(id);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('[Z] starts with zero cards and reports all-finalized for empty state', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));

    expect(result.current.cards.size).toBe(0);
    expect(result.current.allFinalized).toBe(true);
  });

  it('[O] reveals one segment to completion over time when TTS gating is off', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));
    const seg = makeSegment({ segmentIndex: 0, text: 'abcdefghij' });

    let bodyChars = -1;
    act(() => {
      bodyChars = result.current.pushSegment(seg);
    });
    expect(bodyChars).toBe(10);

    advance(700);

    const card = result.current.cards.get(0);
    expect(card?.finalized).toBe(true);
    expect(card?.revealedChars).toBe(14);
    expect(result.current.allFinalized).toBe(true);
  });

  it('[M] reveals many segments sequentially without advancing later cards early', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));

    act(() => {
      result.current.pushSegment(makeSegment({ segmentIndex: 0, text: 'abcdefghij' }));
      result.current.pushSegment(makeSegment({ segmentIndex: 1, text: 'klmnopqrst' }));
    });

    advance(250);
    const firstEarly = result.current.cards.get(0);
    const secondEarly = result.current.cards.get(1);
    expect(firstEarly?.revealedChars).toBeGreaterThan(4);
    expect(secondEarly?.revealedChars).toBe(4);

    advance(600);
    const firstLate = result.current.cards.get(0);
    const secondLate = result.current.cards.get(1);
    expect(firstLate?.finalized).toBe(true);
    expect(secondLate?.revealedChars).toBeGreaterThan(4);
  });

  it('[B] enforces TTS budget boundaries and clamps reveal allowance at total chars', () => {
    const { result } = renderHook(() => useTypewriter(true, 20));
    act(() => {
      result.current.pushSegment(makeSegment({ segmentIndex: 5, text: 'abcdefghij' }));
    });

    advance(1000);
    const beforeChunk = result.current.cards.get(5);
    expect(beforeChunk?.revealedChars).toBe(4);

    act(() => {
      result.current.onRevealChunk(5, 3, 0.3);
    });
    advance(500);
    const afterSmallChunk = result.current.cards.get(5);
    expect(afterSmallChunk?.revealedChars).toBe(7);

    act(() => {
      result.current.onRevealChunk(5, 100, 1);
    });
    advance(2000);
    const finalized = result.current.cards.get(5);
    expect(finalized?.revealedChars).toBe(14);
    expect(finalized?.finalized).toBe(true);
  });

  it('[I] returns stable push contracts by ignoring duplicate segment indexes', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));

    let firstPush = -1;
    let duplicatePush = -1;
    act(() => {
      firstPush = result.current.pushSegment(makeSegment({ segmentIndex: 9, text: 'alpha' }));
      duplicatePush = result.current.pushSegment(makeSegment({ segmentIndex: 9, text: 'beta' }));
    });

    expect(firstPush).toBe(5);
    expect(duplicatePush).toBe(-1);
    expect(result.current.cards.size).toBe(1);
    expect(result.current.cards.get(9)?.spans.map((span) => span.text).join('')).toBe('HEADalpha');
  });

  it('[E] tolerates unknown segment operations without throwing and without state mutation', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));
    act(() => {
      result.current.pushSegment(makeSegment({ segmentIndex: 2, text: 'stable' }));
    });
    const before = result.current.cards.get(2)?.revealedChars;

    expect(() => {
      result.current.onRevealChunk(999, 5, 1);
      result.current.finalizeSegment(999);
    }).not.toThrow();

    const after = result.current.cards.get(2)?.revealedChars;
    expect(after).toBe(before);
  });

  it('[S] follows standard skip flow by finalizing current card and advancing the next', () => {
    const { result } = renderHook(() => useTypewriter(false, 20));
    act(() => {
      result.current.pushSegment(makeSegment({ segmentIndex: 0, text: 'abcdefghij' }));
      result.current.pushSegment(makeSegment({ segmentIndex: 1, text: 'klmnopqrst' }));
    });

    advance(200);
    act(() => {
      result.current.skipCurrent();
    });

    expect(result.current.cards.get(0)?.finalized).toBe(true);

    advance(100);
    expect(result.current.cards.get(1)?.revealedChars).toBeGreaterThan(4);
  });
});
