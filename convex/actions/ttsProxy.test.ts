import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractHandler } from '../test-utils.js';

const proxyMocks = vi.hoisted(() => ({
  constructorApiKeys: [] as string[],
  generateSpeech: vi.fn(),
}));

vi.mock('../../src/io/inworld-tts-client.js', () => ({
  InworldTTSClient: class InworldTTSClient {
    private readonly apiKey: string;

    constructor(apiKey: string) {
      this.apiKey = apiKey;
      proxyMocks.constructorApiKeys.push(apiKey);
    }

    generateSpeech(args: unknown) {
      return proxyMocks.generateSpeech(args, this.apiKey) as Promise<unknown>;
    }
  },
}));

import { generateTTS } from './ttsProxy';

type TTSArgs = {
  text: string;
  voiceId: string;
  temperature: number;
  speakingRate: number;
};

type TTSResult =
  | { ok: true; wavBase64: string }
  | { ok: false; error: string; status: number };

const handler = extractHandler<unknown, TTSArgs, TTSResult>(generateTTS);

function makeArgs(overrides?: Partial<TTSArgs>): TTSArgs {
  return {
    text: 'Coolant pressure stable.',
    voiceId: 'Elizabeth',
    temperature: 0.7,
    speakingRate: 1.0,
    ...overrides,
  };
}

describe('ttsProxy action contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyMocks.constructorApiKeys.length = 0;
    proxyMocks.generateSpeech.mockResolvedValue({
      ok: true,
      wavBase64: 'UklGRiQAAABXQVZF',
    });
    vi.stubEnv('INWORLD_API_KEY', 'inworld-key-test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('[Z] returns configuration error when zero API key is present', async () => {
    delete process.env.INWORLD_API_KEY;

    await expect(handler({}, makeArgs())).resolves.toEqual({
      ok: false,
      error: 'TTS not configured',
      status: 503,
    });
    expect(proxyMocks.generateSpeech).not.toHaveBeenCalled();
  });

  it('[O] forwards one request and returns one successful wav payload', async () => {
    const args = makeArgs();

    const result = await handler({}, args);
    expect(result).toEqual({
      ok: true,
      wavBase64: 'UklGRiQAAABXQVZF',
    });
    expect(proxyMocks.constructorApiKeys).toEqual(['inworld-key-test']);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledWith(args, 'inworld-key-test');
  });

  it('[M] handles many sequential requests with independent argument payloads', async () => {
    proxyMocks.generateSpeech
      .mockResolvedValueOnce({ ok: true, wavBase64: 'wav-1' })
      .mockResolvedValueOnce({ ok: true, wavBase64: 'wav-2' });

    const first = await handler({}, makeArgs({ text: 'First', voiceId: 'Alex' }));
    const second = await handler({}, makeArgs({ text: 'Second', voiceId: 'Ronald' }));

    expect(first).toEqual({ ok: true, wavBase64: 'wav-1' });
    expect(second).toEqual({ ok: true, wavBase64: 'wav-2' });
    expect(proxyMocks.generateSpeech).toHaveBeenCalledTimes(2);
    expect(proxyMocks.generateSpeech.mock.calls.map((call) => (call[0] as TTSArgs).text)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('[B] preserves boundary numeric inputs for speaking rate and temperature', async () => {
    const args = makeArgs({ temperature: 0, speakingRate: 2.5 });

    await handler({}, args);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        speakingRate: 2.5,
      }),
      'inworld-key-test',
    );
  });

  it('[I] preserves request interface fields passed to the downstream TTS client', async () => {
    const args = makeArgs({
      text: 'Atmosphere alarm acknowledged.',
      voiceId: 'Luna',
      temperature: 1.1,
      speakingRate: 1.15,
    });

    await handler({}, args);
    const forwarded = proxyMocks.generateSpeech.mock.calls[0]?.[0] as TTSArgs | undefined;
    expect(forwarded).toEqual({
      text: 'Atmosphere alarm acknowledged.',
      voiceId: 'Luna',
      temperature: 1.1,
      speakingRate: 1.15,
    });
  });

  it('[E] surfaces explicit downstream error payloads unchanged', async () => {
    proxyMocks.generateSpeech.mockResolvedValue({
      ok: false,
      error: 'Inworld API error: rate limited',
      status: 502,
    });

    await expect(handler({}, makeArgs())).resolves.toEqual({
      ok: false,
      error: 'Inworld API error: rate limited',
      status: 502,
    });
  });

  it('[S] follows standard configured flow: construct client then invoke generateSpeech once', async () => {
    await handler({}, makeArgs());

    expect(proxyMocks.constructorApiKeys).toEqual(['inworld-key-test']);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledTimes(1);
  });
});
