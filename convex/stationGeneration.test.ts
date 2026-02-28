import { describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { start } from './stationGeneration';

type StartArgs = {
  difficulty: 'normal' | 'hard' | 'nightmare';
  characterClass: 'engineer' | 'scientist' | 'medic' | 'commander';
};

type StartCtx = {
  runMutation: (
    ref: unknown,
    args: { config: { difficulty: StartArgs['difficulty']; characterClass: StartArgs['characterClass'] } },
  ) => Promise<Id<'generationProgress'>>;
  scheduler: {
    runAfter: (
      delayMs: number,
      ref: unknown,
      args: {
        progressId: Id<'generationProgress'>;
        difficulty: StartArgs['difficulty'];
        characterClass: StartArgs['characterClass'];
      },
    ) => Promise<void>;
  };
};

const startHandler = (
  start as unknown as {
    _handler: (ctx: StartCtx, args: StartArgs) => Promise<Id<'generationProgress'>>;
  }
)._handler;

function makeArgs(overrides?: Partial<StartArgs>): StartArgs {
  return {
    difficulty: 'normal',
    characterClass: 'engineer',
    ...overrides,
  };
}

function createHarness(options?: {
  progressIds?: Array<Id<'generationProgress'>>;
  throwOnCreate?: Error;
}) {
  const progressIds =
    options?.progressIds ?? (['progress_1' as Id<'generationProgress'>, 'progress_2' as Id<'generationProgress'>]);
  let idx = 0;

  let mutationCallCount = 0;
  const runMutation = vi.fn((_ref: unknown, _args: unknown) => {
    mutationCallCount += 1;
    if (options?.throwOnCreate && mutationCallCount === 1) {
      return Promise.reject(options.throwOnCreate);
    }
    const nextId = progressIds[Math.min(idx, progressIds.length - 1)];
    if (!nextId) {
      throw new Error('missing progress id fixture');
    }
    idx += 1;
    return Promise.resolve(nextId);
  });
  const runAfter = vi.fn(() => Promise.resolve());

  const ctx: StartCtx = {
    runMutation: runMutation as StartCtx['runMutation'],
    scheduler: {
      runAfter: runAfter as StartCtx['scheduler']['runAfter'],
    },
  };

  return { ctx, runMutation, runAfter };
}

describe('stationGeneration start orchestration', () => {
  it('[Z] starts generation from zero prior state and returns a progress id', async () => {
    const { ctx } = createHarness({ progressIds: ['progress_zero' as Id<'generationProgress'>] });

    const progressId = await startHandler(ctx, makeArgs());

    expect(progressId).toBe('progress_zero');
  });

  it('[O] performs one create plus one scheduler call for a single start request', async () => {
    const { ctx, runMutation, runAfter } = createHarness();
    const args = makeArgs();

    const progressId = await startHandler(ctx, args);

    expect(progressId).toBe('progress_1');
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(internal.generationProgress.create, {
      config: { difficulty: args.difficulty, characterClass: args.characterClass },
    });
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter).toHaveBeenCalledWith(0, internal.actions.generateStation.generate, {
      progressId: 'progress_1',
      difficulty: args.difficulty,
      characterClass: args.characterClass,
    });
  });

  it('[M] supports many sequential starts with independent progress ids and scheduled payloads', async () => {
    const { ctx, runAfter } = createHarness({
      progressIds: ['progress_a' as Id<'generationProgress'>, 'progress_b' as Id<'generationProgress'>],
    });

    const first = await startHandler(ctx, makeArgs({ characterClass: 'medic' }));
    const second = await startHandler(ctx, makeArgs({ difficulty: 'hard', characterClass: 'commander' }));

    expect(first).toBe('progress_a');
    expect(second).toBe('progress_b');
    expect(runAfter).toHaveBeenNthCalledWith(1, 0, internal.actions.generateStation.generate, {
      progressId: 'progress_a',
      difficulty: 'normal',
      characterClass: 'medic',
    });
    expect(runAfter).toHaveBeenNthCalledWith(2, 0, internal.actions.generateStation.generate, {
      progressId: 'progress_b',
      difficulty: 'hard',
      characterClass: 'commander',
    });
  });

  it('[B] preserves boundary difficulty-class combinations like nightmare commander payloads', async () => {
    const { ctx, runMutation, runAfter } = createHarness({
      progressIds: ['progress_edge' as Id<'generationProgress'>],
    });
    const args = makeArgs({ difficulty: 'nightmare', characterClass: 'commander' });

    const progressId = await startHandler(ctx, args);

    expect(progressId).toBe('progress_edge');
    expect(runMutation).toHaveBeenCalledWith(internal.generationProgress.create, {
      config: { difficulty: 'nightmare', characterClass: 'commander' },
    });
    expect(runAfter).toHaveBeenCalledWith(0, internal.actions.generateStation.generate, {
      progressId: 'progress_edge',
      difficulty: 'nightmare',
      characterClass: 'commander',
    });
  });

  it('[I] preserves return interface invariants as generationProgress id strings', async () => {
    const { ctx } = createHarness({ progressIds: ['progress_interface' as Id<'generationProgress'>] });

    const result = await startHandler(ctx, makeArgs());

    expect(typeof result).toBe('string');
    expect(result).toBe('progress_interface');
  });

  it('[E] throws explicit errors and skips scheduling when progress creation fails', async () => {
    const { ctx, runAfter } = createHarness({
      throwOnCreate: new Error('create failed'),
    });

    await expect(startHandler(ctx, makeArgs())).rejects.toThrow('create failed');
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('[S] follows the standard create-then-schedule flow with matching shared payload fields', async () => {
    const { ctx, runMutation, runAfter } = createHarness({
      progressIds: ['progress_standard' as Id<'generationProgress'>],
    });
    const args = makeArgs({ difficulty: 'hard', characterClass: 'scientist' });

    await expect(startHandler(ctx, args)).resolves.toBe('progress_standard');

    expect(runMutation).toHaveBeenCalledWith(internal.generationProgress.create, {
      config: { difficulty: 'hard', characterClass: 'scientist' },
    });
    expect(runAfter).toHaveBeenCalledWith(0, internal.actions.generateStation.generate, {
      progressId: 'progress_standard',
      difficulty: 'hard',
      characterClass: 'scientist',
    });
  });
});
