import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import type { Difficulty, CharacterClassId } from '../../src/types.js';
import type { ProgressStatus } from '../generationProgress.js';
import { extractHandler } from '../test_utils.js';

const dynamicMocks = vi.hoisted(() => ({
  generateStation: vi.fn(),
  assembleStation: vi.fn(),
  serializeStation: vi.fn(),
  clientCtorArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../src/generation/index.js', () => ({
  generateStation: dynamicMocks.generateStation,
}));

vi.mock('../../src/io/openrouter-ai-client.js', () => ({
  OpenRouterAITextClient: function OpenRouterAITextClient(args: Record<string, unknown>) {
    dynamicMocks.clientCtorArgs.push(args);
  },
}));

vi.mock('../../src/model-catalog.js', () => ({
  GENERATION_MODEL_ID: 'z-ai/glm-5',
  GENERATION_MODELS: [
    { id: 'z-ai/glm-5', label: 'GLM-5' },
    { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  ],
  isValidGenerationModelId: vi.fn((id: string) => ['z-ai/glm-5', 'anthropic/claude-opus-4.6'].includes(id)),
  VIDEO_MODEL_ID: 'fal-ai/bytedance/seedance/v1/pro/fast/text-to-video',
  IMAGE_MODEL_ID: 'fal-ai/flux/schnell',
}));

vi.mock('../../src/assembly.js', () => ({
  assembleStation: dynamicMocks.assembleStation,
}));

vi.mock('../lib/serialization.js', () => ({
  serializeStation: dynamicMocks.serializeStation,
}));

const videoMocks = vi.hoisted(() => ({
  generateVideo: vi.fn(),
}));

vi.mock('../../src/video-prompts.js', () => ({
  buildBriefingVideoPrompt: () => 'mock video prompt',
}));

vi.mock('../../src/io/fal-video-client.js', () => ({
  FalVideoClient: function FalVideoClient() {
    return { generateVideo: videoMocks.generateVideo };
  },
}));

import { generate } from './generateStation';

type GenerateArgs = {
  progressId: Id<'generationProgress'>;
  difficulty: Difficulty;
  characterClass: CharacterClassId;
};

type MutationCall = {
  ref: unknown;
  args: Record<string, unknown>;
};

type SchedulerCall = {
  delay: number;
  ref: unknown;
  args: Record<string, unknown>;
};

type GenerateCtx = {
  runMutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  scheduler: {
    runAfter: (delay: number, ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
  storage: {
    store: (blob: unknown) => Promise<unknown>;
  };
};

const handler = extractHandler<GenerateCtx, GenerateArgs, null>(generate);

function makeArgs(overrides?: Partial<GenerateArgs>): GenerateArgs {
  return {
    progressId: 'progress_1' as Id<'generationProgress'>,
    difficulty: 'hard',
    characterClass: 'engineer',
    ...overrides,
  };
}

function createHarness() {
  const mutationCalls: MutationCall[] = [];
  const schedulerCalls: SchedulerCall[] = [];

  const ctx: GenerateCtx = {
    runMutation: vi.fn((ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref, args });

      if ('stationName' in args && 'briefing' in args && 'difficulty' in args && 'data' in args) {
        return Promise.resolve('station_saved' as Id<'stations'>);
      }
      return Promise.resolve(null);
    }),
    scheduler: {
      runAfter: vi.fn((delay: number, ref: unknown, args: Record<string, unknown>) => {
        schedulerCalls.push({ delay, ref, args });
        return Promise.resolve(null);
      }),
    },
    storage: {
      store: vi.fn(() => Promise.resolve('storage_video_1' as Id<'_storage'>)),
    },
  };

  return { ctx, mutationCalls, schedulerCalls };
}

function progressCalls(calls: MutationCall[]) {
  return calls.filter((call) => {
    const args = call.args;
    return (
      'id' in args &&
      'status' in args &&
      'message' in args &&
      'progress' in args
    );
  });
}

function completionCall(calls: MutationCall[]) {
  return progressCalls(calls).find((call) => call.args.status === 'complete');
}

function errorCall(calls: MutationCall[]) {
  return progressCalls(calls).find((call) => call.args.status === 'error');
}

describe('generateStation action orchestration contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dynamicMocks.clientCtorArgs.length = 0;
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');

    dynamicMocks.generateStation.mockImplementation(
      (_config: unknown, onProgress?: (msg: string) => void) => {
        onProgress?.('Designing station layout...');
        return Promise.resolve({
          skeleton: { id: 'skeleton_1' },
          creative: { id: 'creative_1' },
        });
      },
    );
    dynamicMocks.assembleStation.mockReturnValue({
      stationName: 'Tachyon Drift',
      briefing: 'Restore failing systems and extract.',
    });
    dynamicMocks.serializeStation.mockReturnValue({
      rooms: { room_0: { name: 'Docking Vestibule' } },
    });
  });

  it('[Z] completes generation even when zero intermediate progress callbacks are emitted', async () => {
    dynamicMocks.generateStation.mockImplementation(() => Promise.resolve({
      skeleton: { id: 'skeleton_1' },
      creative: { id: 'creative_1' },
    }));

    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const completion = completionCall(mutationCalls);
    expect(completion?.args).toMatchObject({
      status: 'complete',
      progress: 100,
      stationId: 'station_saved',
    });
  });

  it('[O] persists one mapped topology-stage update before final completion', async () => {
    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const updates = progressCalls(mutationCalls);
    expect(updates[0]?.args).toMatchObject({
      id: 'progress_1',
      status: 'topology',
      message: 'Designing station layout...',
      progress: 10,
    });
    expect(completionCall(mutationCalls)?.args.status).toBe('complete');
  });

  it('[M] maps many stage callbacks and preserves ordered lifecycle progression', async () => {
    dynamicMocks.generateStation.mockImplementation(
      (_config: unknown, onProgress?: (msg: string) => void) => {
        onProgress?.('Designing station layout...');
        onProgress?.('Engineering system failures...');
        onProgress?.('Designing mission objectives...');
        onProgress?.('Generating creative content...');
        onProgress?.('Assembling station data...');
        return Promise.resolve({
          skeleton: { id: 'skeleton_many' },
          creative: { id: 'creative_many' },
        });
      },
    );

    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const statuses = progressCalls(mutationCalls).map((call) => call.args.status as ProgressStatus);
    expect(statuses).toEqual([
      'topology',
      'systems',
      'objectives',
      'creative',
      'assembly',
      'complete',
    ]);
  });

  it('[B] keeps last mapped stage when receiving an unmapped progress message boundary', async () => {
    dynamicMocks.generateStation.mockImplementation(
      (_config: unknown, onProgress?: (msg: string) => void) => {
        onProgress?.('Designing station layout...');
        onProgress?.('Checkpoint reached');
        return Promise.resolve({
          skeleton: { id: 'skeleton_boundary' },
          creative: { id: 'creative_boundary' },
        });
      },
    );

    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const updates = progressCalls(mutationCalls);
    expect(updates[1]?.args).toMatchObject({
      status: 'topology',
      message: 'Checkpoint reached',
      progress: 10,
    });
  });

  it('[I] constructs AI client and save payload with expected interface contracts', async () => {
    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs({ difficulty: 'nightmare' }))).resolves.toBeNull();

    expect(dynamicMocks.clientCtorArgs[0]).toEqual({
      apiKey: 'test-openrouter-key',
      referer: 'https://github.com/station-omega',
      title: 'Station Omega',
    });

    const stationSave = mutationCalls.find((call) => (
      'stationName' in call.args && 'data' in call.args && 'difficulty' in call.args
    ));
    expect(stationSave?.args).toMatchObject({
      stationName: 'Tachyon Drift',
      briefing: 'Restore failing systems and extract.',
      difficulty: 'nightmare',
      data: { rooms: { room_0: { name: 'Docking Vestibule' } } },
    });
  });

  it('[E] reports explicit error progress and skips station save when generation throws', async () => {
    dynamicMocks.generateStation.mockImplementation(
      () => Promise.reject(new Error('generation pipeline failed')),
    );

    const { ctx, mutationCalls } = createHarness();
    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    expect(errorCall(mutationCalls)?.args).toMatchObject({
      id: 'progress_1',
      status: 'error',
      message: 'Station generation failed',
      progress: 0,
      error: 'generation pipeline failed',
    });
    const stationSave = mutationCalls.find((call) => 'stationName' in call.args);
    expect(stationSave).toBeUndefined();
  });

  it('[S] follows standard successful flow through assembly serialization save and completion', async () => {
    const { ctx, mutationCalls } = createHarness();
    const args = makeArgs({ characterClass: 'scientist' });

    await expect(handler(ctx, args)).resolves.toBeNull();

    expect(dynamicMocks.generateStation).toHaveBeenCalledTimes(1);
    expect(dynamicMocks.assembleStation).toHaveBeenCalledWith(
      { id: 'skeleton_1' },
      { id: 'creative_1' },
    );
    expect(dynamicMocks.serializeStation).toHaveBeenCalledWith({
      stationName: 'Tachyon Drift',
      briefing: 'Restore failing systems and extract.',
    });
    expect(completionCall(mutationCalls)?.args).toMatchObject({
      id: 'progress_1',
      status: 'complete',
      message: 'Station "Tachyon Drift" ready!',
      progress: 100,
      stationId: 'station_saved',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('generateStation video generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dynamicMocks.clientCtorArgs.length = 0;
    videoMocks.generateVideo.mockReset();
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');

    dynamicMocks.generateStation.mockImplementation(
      () => Promise.resolve({
        skeleton: { id: 'skeleton_1' },
        creative: { id: 'creative_1' },
      }),
    );
    dynamicMocks.assembleStation.mockReturnValue({
      stationName: 'Tachyon Drift',
      briefing: 'Restore failing systems and extract.',
    });
    dynamicMocks.serializeStation.mockReturnValue({
      rooms: { room_0: { name: 'Docking Vestibule' } },
    });
    videoMocks.generateVideo.mockResolvedValue({
      videoBytes: new Uint8Array([1, 2, 3]),
      mimeType: 'video/mp4',
    });
  });

  it('[Z] does not generate video when FAL_API_KEY is absent', async () => {
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    expect(videoMocks.generateVideo).not.toHaveBeenCalled();
    const videoProgress = progressCalls(mutationCalls).find((c) => c.args.status === 'video');
    expect(videoProgress).toBeUndefined();
  });

  it('[O] generates exactly one video when FAL_API_KEY is set', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    expect(videoMocks.generateVideo).toHaveBeenCalledTimes(1);
    const saveCalls = mutationCalls.filter((c) => 'cacheKey' in c.args && c.args.cacheKey === 'briefing_video');
    expect(saveCalls).toHaveLength(1);
  });

  it('[M] reports video progress status before generation', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    const videoProgress = progressCalls(mutationCalls).find((c) => c.args.status === 'video');
    expect(videoProgress?.args).toMatchObject({
      status: 'video',
      progress: 95,
      message: 'Generating briefing video...',
    });
  });

  it('[B] still completes when video generation throws (non-fatal)', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    videoMocks.generateVideo.mockRejectedValue(new Error('video generation failed'));
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    expect(completionCall(mutationCalls)?.args).toMatchObject({
      status: 'complete',
      progress: 100,
    });
  });

  it('[I] passes correct prompt and storage contract to video pipeline', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    expect(videoMocks.generateVideo).toHaveBeenCalledWith({ prompt: 'mock video prompt' });
    expect(ctx.storage.store).toHaveBeenCalledTimes(1);
    const saveCalls = mutationCalls.filter((c) => 'cacheKey' in c.args && c.args.cacheKey === 'briefing_video');
    expect(saveCalls[0].args).toMatchObject({
      stationId: 'station_saved',
      cacheKey: 'briefing_video',
      storageId: 'storage_video_1',
      prompt: 'mock video prompt',
      category: 'briefing_video',
    });
  });

  it('[E] logs error but does not set error status when video fails', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    videoMocks.generateVideo.mockRejectedValue(new Error('fal.ai timeout'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    const errorProgress = progressCalls(mutationCalls).find((c) => c.args.status === 'error');
    expect(errorProgress).toBeUndefined();
    expect(completionCall(mutationCalls)?.args.status).toBe('complete');
    consoleSpy.mockRestore();
  });

  it('[S] follows standard flow: progress update → generate → store → save → complete', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-fal-key');
    const { ctx, mutationCalls } = createHarness();
    await handler(ctx, makeArgs());
    const statuses = progressCalls(mutationCalls).map((c) => c.args.status);
    const videoIdx = statuses.indexOf('video');
    const completeIdx = statuses.indexOf('complete');
    expect(videoIdx).toBeGreaterThanOrEqual(0);
    expect(completeIdx).toBeGreaterThan(videoIdx);
    expect(videoMocks.generateVideo).toHaveBeenCalledTimes(1);
    expect(ctx.storage.store).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
