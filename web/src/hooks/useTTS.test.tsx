import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTTS } from './useTTS';
import { makeSegment } from './__test-support__/makeSegment';

const serviceMocks = vi.hoisted(() => ({
  requestTTSAudio: vi.fn(),
}));

vi.mock('../services/tts-client', () => ({
  requestTTSAudio: serviceMocks.requestTTSAudio,
}));

function makeWavBuffer(durationSec = 0.2): ArrayBuffer {
  const byteRate = 96_000;
  const dataSize = Math.max(1, Math.floor(durationSec * byteRate));
  const totalSize = 44 + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  view.setUint32(28, byteRate, true);
  return buffer;
}

describe('useTTS stream contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    serviceMocks.requestTTSAudio.mockResolvedValue(makeWavBuffer());

    class FakeAudioContext {
      state: 'running' | 'suspended' | 'closed' = 'running';
      destination = {};

      resume() {
        this.state = 'running';
        return Promise.resolve();
      }

      close() {
        this.state = 'closed';
        return Promise.resolve();
      }

      decodeAudioData() {
        return Promise.resolve({ duration: 0.2 } as AudioBuffer);
      }

      createBufferSource() {
        const source = {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          onended: null as (() => void) | null,
          start: vi.fn(),
        };
        source.start.mockImplementation(() => {
          setTimeout(() => {
            source.onended?.();
          }, 1);
        });
        return source as unknown as AudioBufferSourceNode;
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('[Z] completes cleanly with zero segments and emits no reveal chunks', async () => {
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onRevealChunk).not.toHaveBeenCalled();
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(serviceMocks.requestTTSAudio).not.toHaveBeenCalled();
  });

  it('[O] streams one segment into one reveal callback with matching character budget', async () => {
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 0, type: 'narration', text: 'I check the relay panel.' }), 12);
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(serviceMocks.requestTTSAudio).toHaveBeenCalledTimes(1);
    expect(onRevealChunk).toHaveBeenCalledTimes(1);
    expect(onRevealChunk).toHaveBeenCalledWith(0, 12, expect.any(Number));
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('[M] preserves ordered reveal sequencing across many queued segments', async () => {
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 0, type: 'narration', text: 'First action.' }), 8);
      result.current.pushSegment(makeSegment({ segmentIndex: 1, type: 'thought', text: 'Second thought.' }), 9);
      result.current.pushSegment(makeSegment({ segmentIndex: 2, type: 'dialogue', text: 'Third response.', npcId: 'npc_1' }), 10);
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const order = onRevealChunk.mock.calls.map((call): number => Number(call[0]));
    expect(order).toEqual([0, 1, 2]);
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('[B] falls back to safe reveal timing at minimum duration when TTS generation returns null', async () => {
    serviceMocks.requestTTSAudio.mockResolvedValueOnce(null);
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 4, type: 'narration', text: 'Boundary fallback sentence.' }), 24);
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onRevealChunk).toHaveBeenCalledTimes(1);
    expect(onRevealChunk.mock.calls[0]?.[2]).toBeGreaterThanOrEqual(0.5);
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('[I] applies segment-type voice and tuning interface mappings to TTS requests', async () => {
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 5, type: 'thought', text: 'I recompute the pressure margins.' }), 18);
      result.current.pushSegment(
        makeSegment({ segmentIndex: 6, type: 'diagnostic_readout', text: 'COOLANT LOOP: 4.1 bar nominal.' }),
        20,
      );
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const requestBodies = serviceMocks.requestTTSAudio.mock.calls.map(
      (call) => call[1] as { voiceId: string; temperature: number; speakingRate: number },
    );
    expect(requestBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ voiceId: 'Alex', temperature: 1.3, speakingRate: 1.05 }),
        expect.objectContaining({ voiceId: 'Elizabeth', temperature: 0.4, speakingRate: 1.1 }),
      ]),
    );
  });

  it('[E] handles missing proxy configuration safely without TTS requests or crashes', async () => {
    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS(null, true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 7, type: 'narration', text: 'Engine room status nominal.' }), 15);
      result.current.flushStream();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(serviceMocks.requestTTSAudio).not.toHaveBeenCalled();
    expect(onRevealChunk).toHaveBeenCalledTimes(1);
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('[S] follows standard stop flow by aborting in-flight generation before reveal playback', async () => {
    const captured = { signal: null as AbortSignal | null };
    serviceMocks.requestTTSAudio.mockImplementation(
      async (_url: string, _body: unknown, signal: AbortSignal) => {
        captured.signal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          }, { once: true });
        });
        return null;
      },
    );

    const onRevealChunk = vi.fn();
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() =>
      useTTS('https://tts.local', true, onRevealChunk, onStreamComplete),
    );

    act(() => {
      result.current.beginStream();
      result.current.pushSegment(makeSegment({ segmentIndex: 8, type: 'narration', text: 'Pending segment to cancel.' }), 14);
      result.current.stop();
    });

    await act(async () => {
      await Promise.resolve();
      await vi.runAllTimersAsync();
    });

    expect(captured.signal?.aborted).toBe(true);
    expect(onRevealChunk).not.toHaveBeenCalled();
  });
});
