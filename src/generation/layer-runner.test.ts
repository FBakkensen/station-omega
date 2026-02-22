import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LayerConfig, LayerContext } from './layer-runner.js';
import { LayerGenerationError, runLayer } from './layer-runner.js';
import { StrictAIMockQueue } from '../../test/utils/strict-ai-mock.js';

const { mockStreamText, mockOutputObject } = vi.hoisted(() => ({
  mockStreamText: vi.fn<(options: unknown) => unknown>(),
  mockOutputObject: vi.fn<(options: unknown) => unknown>(),
}));

vi.mock('ai', () => ({
  streamText: mockStreamText,
  Output: {
    object: mockOutputObject,
  },
}));

interface TestSchema {
  value: string;
}

const schema = z.object({
  value: z.string(),
});

const context: LayerContext = {
  difficulty: 'normal',
  characterClass: 'engineer',
};

const model = {} as never;

function createConfig(
  overrides: Partial<LayerConfig<TestSchema, TestSchema>> = {},
): LayerConfig<TestSchema, TestSchema> {
  return {
    name: 'Test Layer',
    schema,
    buildPrompt: (_ctx, errors) => ({
      system: 'system prompt',
      user: errors ? `retry with ${errors.join(',')}` : 'initial prompt',
    }),
    validate: (output) => ({ success: true, value: output }),
    maxRetries: 1,
    ...overrides,
  };
}

describe('runLayer', () => {
  let strictAI: StrictAIMockQueue;

  beforeEach(() => {
    strictAI = new StrictAIMockQueue();
    mockStreamText.mockReset();
    mockOutputObject.mockReset();

    mockOutputObject.mockImplementation((args) =>
      strictAI.outputObjectFactory(args as { schema: { parse: (input: unknown) => unknown } }),
    );
    mockStreamText.mockImplementation((options) =>
      strictAI.streamTextFactory(options as { output: unknown }),
    );
  });

  afterEach(() => {
    strictAI.assertDrained();
  });

  it('[Z] uses a fallback validation error when validator omits details', async () => {
    strictAI.enqueueResult({ value: 'x' });

    const config = createConfig({
      maxRetries: 0,
      validate: () => ({ success: false }),
    });

    await expect(runLayer(config, context, model)).rejects.toThrow('Unknown validation error');
  });

  it('[O] succeeds on the first attempt for valid output', async () => {
    strictAI.enqueueResult({ value: 'ok' });

    const result = await runLayer(createConfig(), context, model);
    expect(result).toEqual({ value: 'ok' });
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('[M] retries after validation failure and then succeeds', async () => {
    strictAI.enqueueResult({ value: 'bad' });
    strictAI.enqueueResult({ value: 'good' });

    let validateCalls = 0;
    const seenErrors: Array<string[] | undefined> = [];
    const config = createConfig({
      buildPrompt: (_ctx, errors) => {
        seenErrors.push(errors);
        return {
          system: 'system prompt',
          user: errors ? `retry with ${errors.join(',')}` : 'initial prompt',
        };
      },
      validate: (output) => {
        validateCalls++;
        if (validateCalls === 1) {
          return { success: false, errors: ['value must improve'] };
        }
        return { success: true, value: output };
      },
      maxRetries: 2,
    });

    const result = await runLayer(config, context, model);
    expect(result.value).toBe('good');
    expect(seenErrors[0]).toBeUndefined();
    expect(seenErrors[1]).toEqual(['value must improve']);
  });

  it('[B] throws LayerGenerationError after exhausting retries', async () => {
    strictAI.enqueueResult({ value: 'still-bad' });
    strictAI.enqueueResult({ value: 'still-bad' });

    const config = createConfig({
      maxRetries: 1,
      validate: () => ({ success: false, errors: ['not acceptable'] }),
    });

    const run = runLayer(config, context, model);
    await expect(run).rejects.toBeInstanceOf(LayerGenerationError);
    await expect(run).rejects.toThrow('failed after 2 attempts');
  });

  it('[I] passes prompt/schema contracts into streamText calls', async () => {
    strictAI.enqueueResult({ value: 'ok' });

    await runLayer(createConfig(), context, model);

    const firstCall = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(firstCall?.['system']).toBe('system prompt');
    expect(firstCall?.['prompt']).toBe('initial prompt');
    expect(mockOutputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: schema,
      }),
    );
    const outputCarrier = firstCall?.['output'];
    expect(outputCarrier && typeof outputCarrier === 'object' && '__strictSchema' in outputCarrier).toBe(
      true,
    );
  });

  it('[E] wraps stream crashes into LayerGenerationError diagnostics', async () => {
    strictAI.enqueueThrow(new Error('provider blew up'));

    const config = createConfig({ maxRetries: 0 });
    await expect(runLayer(config, context, model)).rejects.toThrow('provider blew up');
  });

  it('[S] emits progress/debug hooks during a standard retry flow', async () => {
    strictAI.enqueueResult({ value: 'bad' });
    strictAI.enqueueResult({ value: 'good' });

    const progress: string[] = [];
    const debug: string[] = [];
    let first = true;

    const config = createConfig({
      maxRetries: 1,
      validate: (output) => {
        if (first) {
          first = false;
          return { success: false, errors: ['retry me'] };
        }
        return { success: true, value: output };
      },
    });

    await runLayer(
      config,
      context,
      model,
      (msg) => progress.push(msg),
      undefined,
      (label, content) => debug.push(`${label}:${content}`),
    );

    expect(progress.some((msg) => msg.includes('Retrying Test Layer'))).toBe(true);
    expect(debug.some((msg) => msg.includes('GENERATION-OK'))).toBe(true);
  });

  it('[M] mutation canary: attempts exactly maxRetries + 1 times before failing', async () => {
    strictAI.enqueueResult({ value: 'still-invalid' });
    strictAI.enqueueResult({ value: 'still-invalid' });
    strictAI.enqueueResult({ value: 'still-invalid' });

    const config = createConfig({
      maxRetries: 2,
      validate: () => ({ success: false, errors: ['always invalid'] }),
    });

    await expect(runLayer(config, context, model)).rejects.toThrow(LayerGenerationError);
    expect(mockStreamText).toHaveBeenCalledTimes(3);
  });
});
