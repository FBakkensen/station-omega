import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestTTSAudio } from './tts-client';

describe('requestTTSAudio contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('[Z] returns null for zero-success HTTP responses', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('upstream error', { status: 503 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    await expect(
      requestTTSAudio(
        'https://tts.local/api/tts',
        { text: 'zero', voiceId: 'Alex', temperature: 1, speakingRate: 1 },
        signal,
      ),
    ).resolves.toBeNull();
  });

  it('[O] returns one audio buffer for one successful request', async () => {
    const expected = Uint8Array.from([1, 2, 3]).buffer;
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(expected, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    const out = await requestTTSAudio(
      'https://tts.local/api/tts',
      { text: 'one', voiceId: 'Elizabeth', temperature: 0.6, speakingRate: 1.1 },
      signal,
    );

    expect(out).not.toBeNull();
    expect([...new Uint8Array(out as ArrayBuffer)]).toEqual([...new Uint8Array(expected)]);
  });

  it('[M] handles many sequential calls with independent payloads and responses', async () => {
    const first = Uint8Array.from([10]).buffer;
    const second = Uint8Array.from([20, 21]).buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(first, { status: 200 }))
      .mockResolvedValueOnce(new Response(second, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    const firstOut = await requestTTSAudio(
      'https://tts.local/api/tts',
      { text: 'first', voiceId: 'Alex', temperature: 1, speakingRate: 1 },
      signal,
    );
    const secondOut = await requestTTSAudio(
      'https://tts.local/api/tts',
      { text: 'second', voiceId: 'Ronald', temperature: 1.2, speakingRate: 0.9 },
      signal,
    );

    expect([...new Uint8Array(firstOut as ArrayBuffer)]).toEqual([...new Uint8Array(first)]);
    expect([...new Uint8Array(secondOut as ArrayBuffer)]).toEqual([...new Uint8Array(second)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[B] preserves boundary behavior for successful zero-byte audio payloads', async () => {
    const empty = new ArrayBuffer(0);
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(empty, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    const out = await requestTTSAudio(
      'https://tts.local/api/tts',
      { text: 'boundary', voiceId: 'Wendy', temperature: 0, speakingRate: 0.5 },
      signal,
    );

    expect(out).not.toBeNull();
    expect(out?.byteLength).toBe(0);
  });

  it('[I] preserves fetch request interface fields including method headers body and signal', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(1), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    const payload = {
      text: 'interface',
      voiceId: 'Luna',
      temperature: 1.3,
      speakingRate: 1.05,
    };

    await requestTTSAudio('https://tts.local/api/tts', payload, signal);

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0] as unknown as [unknown, RequestInit | undefined];
    const url = String(firstCall[0]);
    const init = firstCall[1];
    if (!init) throw new Error('Expected fetch init');
    expect(url).toBe('https://tts.local/api/tts');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBe(signal);
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it('[E] propagates fetch errors for explicit network or abort failures', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    await expect(
      requestTTSAudio(
        'https://tts.local/api/tts',
        { text: 'error', voiceId: 'Alex', temperature: 1, speakingRate: 1 },
        signal,
      ),
    ).rejects.toThrow('network down');
  });

  it('[S] follows standard happy path by calling response.arrayBuffer exactly once', async () => {
    const response = new Response(Uint8Array.from([7, 8, 9]), { status: 200 });
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    const fetchMock = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    const out = await requestTTSAudio(
      'https://tts.local/api/tts',
      { text: 'standard', voiceId: 'Mark', temperature: 1, speakingRate: 1 },
      signal,
    );

    expect(out?.byteLength).toBe(3);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });
});
