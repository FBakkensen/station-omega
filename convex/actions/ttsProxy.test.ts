import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractHandler } from '../test_utils.js';

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

vi.mock('../_generated/api', () => ({
  internal: {
    aiLogs: { log: Symbol('aiLogs.log') },
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

type StoredBlob = { blob: Blob };

function createCtx() {
  const stored: StoredBlob[] = [];
  const logCalls: Array<Record<string, unknown>> = [];
  return {
    ctx: {
      storage: {
        store: vi.fn((blob: Blob) => {
          stored.push({ blob });
          return Promise.resolve(`storage_${String(stored.length)}`);
        }),
      },
      runMutation: vi.fn((_ref: unknown, args: Record<string, unknown>) => {
        logCalls.push(args);
        return Promise.resolve();
      }),
    },
    stored,
    logCalls,
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
    const { ctx } = createCtx();

    await expect(handler(ctx, makeArgs())).resolves.toEqual({
      ok: false,
      error: 'TTS not configured',
      status: 503,
    });
    expect(proxyMocks.generateSpeech).not.toHaveBeenCalled();
    expect(ctx.storage.store).not.toHaveBeenCalled();
  });

  it('[O] forwards one request and returns one successful wav payload', async () => {
    const { ctx } = createCtx();
    const args = makeArgs();

    const result = await handler(ctx, args);
    expect(result).toEqual({
      ok: true,
      wavBase64: 'UklGRiQAAABXQVZF',
    });
    expect(proxyMocks.constructorApiKeys).toEqual(['inworld-key-test']);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledWith(args, 'inworld-key-test');
  });

  it('[M] handles many sequential requests with independent argument payloads', async () => {
    const { ctx } = createCtx();
    proxyMocks.generateSpeech
      .mockResolvedValueOnce({ ok: true, wavBase64: 'wav-1' })
      .mockResolvedValueOnce({ ok: true, wavBase64: 'wav-2' });

    const first = await handler(ctx, makeArgs({ text: 'First', voiceId: 'Alex' }));
    const second = await handler(ctx, makeArgs({ text: 'Second', voiceId: 'Ronald' }));

    expect(first).toEqual({ ok: true, wavBase64: 'wav-1' });
    expect(second).toEqual({ ok: true, wavBase64: 'wav-2' });
    expect(proxyMocks.generateSpeech).toHaveBeenCalledTimes(2);
    expect(proxyMocks.generateSpeech.mock.calls.map((call) => (call[0] as TTSArgs).text)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('[B] preserves boundary numeric inputs for speaking rate and temperature', async () => {
    const { ctx } = createCtx();
    const args = makeArgs({ temperature: 0, speakingRate: 2.5 });

    await handler(ctx, args);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        speakingRate: 2.5,
      }),
      'inworld-key-test',
    );
  });

  it('[I] persists audio to storage and logs with storageId in metadata', async () => {
    const { ctx, stored, logCalls } = createCtx();
    const args = makeArgs({ text: 'Atmosphere check.' });

    await handler(ctx, args);

    // Audio stored to _storage
    expect(ctx.storage.store).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);

    // AI log written with storageId reference
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(logCalls[0]).toMatchObject({
      provider: 'inworld',
      operation: 'tts',
      prompt: 'Atmosphere check.',
      status: 'success',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metadata: expect.objectContaining({
        voiceId: 'Elizabeth',
        storageId: 'storage_1',
        textLength: 17,
      }),
    });
  });

  it('[E] logs error status and surfaces downstream error payloads unchanged', async () => {
    const { ctx, logCalls } = createCtx();
    proxyMocks.generateSpeech.mockResolvedValue({
      ok: false,
      error: 'Inworld API error: rate limited',
      status: 502,
    });

    const result = await handler(ctx, makeArgs());

    expect(result).toEqual({
      ok: false,
      error: 'Inworld API error: rate limited',
      status: 502,
    });

    // No audio stored on error
    expect(ctx.storage.store).not.toHaveBeenCalled();

    // Error logged
    expect(logCalls[0]).toMatchObject({
      provider: 'inworld',
      operation: 'tts',
      status: 'error',
      error: 'Inworld API error: rate limited',
    });
  });

  it('[S] follows standard configured flow: construct client, generate, store, log', async () => {
    const { ctx } = createCtx();
    await handler(ctx, makeArgs());

    expect(proxyMocks.constructorApiKeys).toEqual(['inworld-key-test']);
    expect(proxyMocks.generateSpeech).toHaveBeenCalledTimes(1);
    expect(ctx.storage.store).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });
});
