import { describe, expect, it, vi } from 'vitest';
import { InworldTTSClient } from './inworld-tts-client.js';

type FetchResponseLike = {
  ok: boolean;
  text: () => Promise<string>;
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null;
};

function makeStreamResponse(linesByRead: string[]): FetchResponseLike {
  const encoder = new TextEncoder();
  const chunks = linesByRead.map((line) => encoder.encode(line));
  let index = 0;

  return {
    ok: true,
    text: () => Promise.resolve(''),
    body: {
      getReader: () => ({
        read: () => {
          if (index >= chunks.length) return Promise.resolve({ done: true });
          const value = chunks[index];
          index += 1;
          return Promise.resolve({ done: false, value });
        },
      }),
    },
  };
}

function makeRiffChunk(payload: Buffer): string {
  const riffLike = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40), payload]);
  return riffLike.toString('base64');
}

function decodeWavBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

describe('InworldTTSClient streaming contracts', () => {
  it('[Z] returns a valid header-only WAV when zero audio chunks are emitted', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse(['\n']) as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    const result = await client.generateSpeech({
      text: 'Silence test',
      voiceId: 'Ronald',
      temperature: 1,
      speakingRate: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wav = decodeWavBase64(result.wavBase64);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.length).toBe(44);
    expect(wav.readUInt32LE(40)).toBe(0);
  });

  it('[O] packages one raw audio chunk into one WAV payload', async () => {
    const raw = Buffer.from('pcm-one');
    const line = `${JSON.stringify({ result: { audioContent: raw.toString('base64') } })}\n`;
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse([line]) as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    const result = await client.generateSpeech({
      text: 'One chunk',
      voiceId: 'Alex',
      temperature: 1.2,
      speakingRate: 1.1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wav = decodeWavBase64(result.wavBase64);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(40)).toBe(raw.length);
    expect(wav.subarray(44).toString()).toBe('pcm-one');
  });

  it('[M] assembles many mixed raw and riff-embedded chunks while preserving order', async () => {
    const rawA = Buffer.from('raw-A');
    const riffBPayload = Buffer.from('riff-B');
    const rawC = Buffer.from('raw-C');

    const reads = [
      `${JSON.stringify({ result: { audioContent: rawA.toString('base64') } })}\n`,
      `${JSON.stringify({ result: { audioContent: makeRiffChunk(riffBPayload) } })}\n`,
      `${JSON.stringify({ result: { audioContent: rawC.toString('base64') } })}\n`,
    ];
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse(reads) as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    const result = await client.generateSpeech({
      text: 'Many chunks',
      voiceId: 'Elizabeth',
      temperature: 0.7,
      speakingRate: 1.0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wav = decodeWavBase64(result.wavBase64);
    expect(wav.subarray(44).toString()).toBe('raw-Ariff-Braw-C');
  });

  it('[B] keeps boundary behavior stable by ignoring RIFF header-only chunks at 44-byte length', async () => {
    const exact44Riff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]).toString('base64');
    const reads = [`${JSON.stringify({ result: { audioContent: exact44Riff } })}\n`];
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse(reads) as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    const result = await client.generateSpeech({
      text: 'Boundary riff',
      voiceId: 'Priya',
      temperature: 1,
      speakingRate: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wav = decodeWavBase64(result.wavBase64);
    expect(wav.readUInt32LE(40)).toBe(0);
  });

  it('[I] sends expected Inworld request interface fields and authorization header', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse(['\n']) as unknown as Response),
    );
    const client = new InworldTTSClient('key-123', fetchFn);

    await client.generateSpeech({
      text: 'Interface test',
      voiceId: 'Wendy',
      temperature: 1.4,
      speakingRate: 0.95,
    });

    const calls = fetchFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0] as unknown as [unknown, RequestInit | undefined];
    const url = firstCall[0];
    const requestInit = firstCall[1];
    if (!requestInit) throw new Error('Expected fetch init options');
    expect(url).toBe('https://api.inworld.ai/tts/v1/voice:stream');
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Basic key-123',
    });
    if (typeof requestInit.body !== 'string') throw new Error('Expected string body');
    expect(JSON.parse(requestInit.body)).toEqual({
      text: 'Interface test',
      voice_id: 'Wendy',
      model_id: 'inworld-tts-1.5-max',
      audio_config: {
        audio_encoding: 'LINEAR16',
        sample_rate_hertz: 48000,
        speaking_rate: 0.95,
      },
      temperature: 1.4,
    });
  });

  it('[E] returns explicit upstream error contract when API response is not ok', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        text: () => Promise.resolve('quota exceeded'),
        body: null,
      } as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    await expect(
      client.generateSpeech({
        text: 'Failing request',
        voiceId: 'Alex',
        temperature: 1,
        speakingRate: 1,
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'Inworld API error: quota exceeded',
      status: 502,
    });
  });

  it('[S] follows standard resilience flow by skipping malformed lines and parsing trailing buffer JSON', async () => {
    const raw = Buffer.from('tail-audio');
    const reads = [
      'this-is-not-json\n',
      JSON.stringify({ result: { audioContent: raw.toString('base64') } }),
    ];
    const fetchFn = vi.fn(() =>
      Promise.resolve(makeStreamResponse(reads) as unknown as Response),
    );
    const client = new InworldTTSClient('api-key', fetchFn);

    const result = await client.generateSpeech({
      text: 'Trailing parse',
      voiceId: 'Mark',
      temperature: 1,
      speakingRate: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wav = decodeWavBase64(result.wavBase64);
    expect(wav.subarray(44).toString()).toBe('tail-audio');
  });
});
