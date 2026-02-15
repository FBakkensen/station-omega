/**
 * Generic layer execution engine with validation and retry.
 *
 * Each generation layer has a schema, prompt builder, and validator.
 * The runner orchestrates: build prompt → AI call → validate → retry
 * with error messages injected into the prompt on each retry.
 */

import { streamText, Output } from 'ai';
import type { LanguageModel } from 'ai';
import type { ZodType } from 'zod';
import type { ValidationResult } from './validate.js';

type StreamTextOptions = Parameters<typeof streamText>[0];
type ProviderOptions = StreamTextOptions['providerOptions'];

export interface LayerContext {
    difficulty: 'normal' | 'hard' | 'nightmare';
    characterClass: string;
    /** Accumulates validated output from earlier layers. */
    [key: string]: unknown;
}

export interface LayerConfig<TSchema, TValidated> {
    name: string;
    schema: ZodType<TSchema>;
    buildPrompt: (context: LayerContext, errors?: string[]) => { system: string; user: string };
    validate: (output: TSchema, context: LayerContext) => ValidationResult<TValidated>;
    maxRetries: number;
    /** Per-attempt timeout in milliseconds. Default: 90_000 (90s). */
    timeoutMs?: number;
    /** Max output tokens for this layer. Default: 8192. */
    maxOutputTokens?: number;
}

export class LayerGenerationError extends Error {
    constructor(
        public readonly layerName: string,
        public readonly attempts: number,
        public readonly allErrors: string[][],
    ) {
        const summary = allErrors
            .map((errs, i) => `  Attempt ${String(i + 1)}: ${errs.join('; ')}`)
            .join('\n');
        super(`Layer "${layerName}" failed after ${String(attempts)} attempts:\n${summary}`);
        this.name = 'LayerGenerationError';
    }
}

export async function runLayer<TSchema, TValidated>(
    config: LayerConfig<TSchema, TValidated>,
    context: LayerContext,
    model: LanguageModel,
    onProgress?: (msg: string) => void,
    providerOptions?: ProviderOptions,
): Promise<TValidated> {
    const allErrors: string[][] = [];
    const maxAttempts = config.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const errors = attempt > 0 ? allErrors[attempt - 1] : undefined;
        const { system, user } = config.buildPrompt(context, errors);

        if (attempt > 0) {
            onProgress?.(`Retrying ${config.name} (attempt ${String(attempt + 1)}/${String(maxAttempts)})...`);
        }

        const abort = new AbortController();
        const timeoutMs = config.timeoutMs ?? 90_000;
        const timeout = setTimeout(() => { abort.abort(); }, timeoutMs);

        try {
            const result = streamText({
                model,
                system,
                prompt: user,
                output: Output.object({ schema: config.schema }),
                temperature: 1.0,
                maxOutputTokens: config.maxOutputTokens ?? 8192,
                abortSignal: abort.signal,
                ...(providerOptions ? { providerOptions } : {}),
            });

            // Consume the stream to completion
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must iterate to drive stream
            for await (const _ of result.textStream) { /* drive stream */ }

            const parsed = await result.output;
            const validation = config.validate(parsed, context);

            if (validation.success && validation.value !== undefined) {
                return validation.value;
            }

            allErrors.push(validation.errors ?? ['Unknown validation error']);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            allErrors.push([`AI call failed: ${message}`]);
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new LayerGenerationError(config.name, maxAttempts, allErrors);
}
