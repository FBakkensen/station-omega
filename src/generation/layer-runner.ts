/**
 * Generic layer execution engine with validation and retry.
 *
 * Each generation layer has a schema, prompt builder, and validator.
 * The runner orchestrates: build prompt → AI call → validate → retry
 * with error messages injected into the prompt on each retry.
 */

import type { ZodType } from 'zod';
import type { ValidationResult } from './validate.js';
import type { AIProviderOptions, AITextClient, UsageData } from '../io/ai-text-client.js';

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
    /** Per-attempt timeout in milliseconds. Default: 300_000 (5min). */
    timeoutMs?: number;
    /** Max output tokens for this layer. Default: 8192. */
    maxOutputTokens?: number;
    /** Optional summary function for debug logging after successful validation. */
    summarize?: (validated: TValidated) => string;
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

/** Extract diagnostic detail from AI SDK errors (APICallError has statusCode, responseBody, url). */
function formatError(err: unknown): string {
    if (!(err instanceof Error)) {
        try { return JSON.stringify(err); } catch { return String(err); }
    }

    const parts: string[] = [`${err.name}: ${err.message}`];

    // Duck-type APICallError properties (readonly class fields are own-properties in ES2022)
    const apiErr = err as unknown as Record<string, unknown>;
    if (typeof apiErr['statusCode'] === 'number') {
        parts.push(`status=${String(apiErr['statusCode'])}`);
    }
    if (typeof apiErr['url'] === 'string') {
        parts.push(`url=${apiErr['url']}`);
    }
    if (typeof apiErr['isRetryable'] === 'boolean') {
        parts.push(`retryable=${String(apiErr['isRetryable'])}`);
    }
    if (typeof apiErr['responseBody'] === 'string' && apiErr['responseBody'].length > 0) {
        // Truncate long response bodies but keep enough for diagnostics
        const body = apiErr['responseBody'].length > 500
            ? apiErr['responseBody'].slice(0, 500) + '...'
            : apiErr['responseBody'];
        parts.push(`body=${body}`);
    }
    if (apiErr['cause'] instanceof Error) {
        parts.push(`cause=${apiErr['cause'].message}`);
    }

    // Fallback: if only message was captured (no extra props), dump all own enumerable keys
    if (parts.length === 1) {
        const ownKeys = Object.getOwnPropertyNames(err).filter(k => k !== 'stack' && k !== 'message' && k !== 'name');
        if (ownKeys.length > 0) {
            const dump: Record<string, unknown> = {};
            for (const k of ownKeys) dump[k] = apiErr[k];
            try { parts.push(`props=${JSON.stringify(dump)}`); } catch { /* skip */ }
        }
    }

    return parts.join(' | ');
}

/** Fibonacci backoff sequence in seconds: each value = sum of previous two, starting 2,2. */
const FIBONACCI_BACKOFF_S = [2, 2, 4, 6, 10, 16, 26, 42, 68, 110];
const MAX_API_RETRIES = FIBONACCI_BACKOFF_S.length;

/**
 * Detect 502/overloaded errors from OpenRouter/Anthropic.
 *
 * The error can surface as:
 * 1. Stream error event — plain object `{code: 502, message: "Overloaded", ...}`
 * 2. APICallError — has `statusCode: 502` and `responseBody` string
 * 3. NoObjectGeneratedError — wraps the real error in `.cause`
 */
function is502Error(err: unknown): boolean {
    if (err == null || typeof err !== 'object') return false;

    const record = err as Record<string, unknown>;

    // Direct status check — APICallError uses `statusCode`, stream error objects use `code`
    if (record['statusCode'] === 502 || record['code'] === 502) return true;

    // Check responseBody for 502 or "Overloaded" (APICallError)
    if (typeof record['responseBody'] === 'string') {
        const body = record['responseBody'];
        if (body.includes('"code":502') || body.includes('"code": 502') || /overloaded/i.test(body)) {
            return true;
        }
    }

    // Check message property — works on both Error instances and plain objects like {message: "Overloaded"}
    if (typeof record['message'] === 'string' && /502|overloaded/i.test(record['message'])) return true;

    // Recurse into cause (NoObjectGeneratedError wraps the real error)
    if (record['cause'] != null && typeof record['cause'] === 'object') {
        return is502Error(record['cause']);
    }

    return false;
}

/**
 * Make a single AI call with 502/overloaded retry using Fibonacci backoff.
 *
 * This handles only provider-level transient failures (502 "Overloaded").
 * Returns the parsed structured output on success, throws on non-502 errors
 * or after exhausting all API retries.
 */
async function streamWithProviderRetry<T>(opts: {
    aiClient: AITextClient;
    modelId: string;
    system: string;
    prompt: string;
    schema: ZodType<T>;
    maxOutputTokens: number;
    timeoutMs: number;
    providerOptions?: AIProviderOptions;
    label: string;
    onProgress?: (msg: string) => void;
    debugLog?: (label: string, content: string) => void;
}): Promise<{ output: T; usage: UsageData }> {
    for (let apiRetry = 0; apiRetry < MAX_API_RETRIES; apiRetry++) {
        const abort = new AbortController();
        const timer = setTimeout(() => { abort.abort(); }, opts.timeoutMs);

        try {
            const result = opts.aiClient.streamStructuredObject({
                modelId: opts.modelId,
                system: opts.system,
                prompt: opts.prompt,
                schema: opts.schema,
                temperature: 1.0,
                maxOutputTokens: opts.maxOutputTokens,
                abortSignal: abort.signal,
                ...(opts.providerOptions ? { providerOptions: opts.providerOptions } : {}),
            });

            // Consume the stream via fullStream to capture error events
            // (textStream silently drops 'error' events — only yields 'text-delta')
            let streamError: unknown;
            for await (const event of result.fullStream) {
                if (event.type === 'error') {
                    streamError = event.error;
                }
            }

            // 502 in stream error → backoff and retry
            if (streamError && is502Error(streamError)) {
                const delaySec = FIBONACCI_BACKOFF_S[apiRetry];
                opts.debugLog?.('PROVIDER-RETRY', `${opts.label} 502/overloaded in stream — retrying in ${String(delaySec)}s (api retry ${String(apiRetry + 1)}/${String(MAX_API_RETRIES)})`);
                opts.onProgress?.(`${opts.label}: provider overloaded, retrying in ${String(delaySec)}s (attempt ${String(apiRetry + 1)}/${String(MAX_API_RETRIES)})...`);
                await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
                continue;
            }

            if (streamError) {
                opts.debugLog?.('STREAM-ERROR', `${opts.label} non-fatal stream error: ${formatError(streamError)}`);
            }

            const [output, usage] = await Promise.all([result.output, result.usage]);
            return { output, usage };
        } catch (err: unknown) {
            // 502 in exception (e.g. APICallError or NoObjectGeneratedError wrapping a 502)
            if (is502Error(err) && apiRetry < MAX_API_RETRIES - 1) {
                const delaySec = FIBONACCI_BACKOFF_S[apiRetry];
                opts.debugLog?.('PROVIDER-RETRY', `${opts.label} 502/overloaded exception — retrying in ${String(delaySec)}s (api retry ${String(apiRetry + 1)}/${String(MAX_API_RETRIES)})`);
                opts.onProgress?.(`${opts.label}: provider overloaded, retrying in ${String(delaySec)}s (attempt ${String(apiRetry + 1)}/${String(MAX_API_RETRIES)})...`);
                await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    throw new Error(`${opts.label}: provider returned 502/overloaded on all ${String(MAX_API_RETRIES)} API retries`);
}

export async function runLayer<TSchema, TValidated>(
    config: LayerConfig<TSchema, TValidated>,
    context: LayerContext,
    aiClient: AITextClient,
    modelId: string,
    onProgress?: (msg: string) => void,
    providerOptions?: AIProviderOptions,
    debugLog?: (label: string, content: string) => void,
): Promise<TValidated> {
    const { value } = await runLayerWithUsage(config, context, aiClient, modelId, onProgress, providerOptions, debugLog);
    return value;
}

export async function runLayerWithUsage<TSchema, TValidated>(
    config: LayerConfig<TSchema, TValidated>,
    context: LayerContext,
    aiClient: AITextClient,
    modelId: string,
    onProgress?: (msg: string) => void,
    providerOptions?: AIProviderOptions,
    debugLog?: (label: string, content: string) => void,
): Promise<{ value: TValidated; usage: UsageData }> {
    const allErrors: string[][] = [];
    const maxAttempts = config.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const attemptStart = Date.now();
        const errors = attempt > 0 ? allErrors[attempt - 1] : undefined;
        const { system, user } = config.buildPrompt(context, errors);
        const label = `${config.name} [attempt ${String(attempt + 1)}]`;

        debugLog?.('LAYER-PROMPT', `${label}\n\n=== System ===\n${system}\n\n=== User ===\n${user}`);

        if (attempt > 0) {
            onProgress?.(`Retrying ${config.name} (attempt ${String(attempt + 1)}/${String(maxAttempts)})...`);
        }

        try {
            const { output: parsed, usage } = await streamWithProviderRetry({
                aiClient,
                modelId,
                system,
                prompt: user,
                schema: config.schema,
                maxOutputTokens: config.maxOutputTokens ?? 8192,
                timeoutMs: config.timeoutMs ?? 300_000,
                providerOptions,
                label,
                onProgress,
                debugLog,
            });

            const elapsedMs = Date.now() - attemptStart;

            debugLog?.('LAYER-RESPONSE', `${label}\n${JSON.stringify(parsed, null, 2)}`);

            const validation = config.validate(parsed, context);

            if (validation.success && validation.value !== undefined) {
                debugLog?.('GENERATION-OK', `${config.name} succeeded on attempt ${String(attempt + 1)} (${String(elapsedMs)}ms)`);
                if (validation.repairs && validation.repairs.length > 0) {
                    debugLog?.('GENERATION-REPAIR', `${config.name} auto-repairs:\n${validation.repairs.map(r => `  • ${r}`).join('\n')}`);
                }
                if (config.summarize) {
                    debugLog?.('GENERATION-OUTPUT', `${config.name} summary:\n${config.summarize(validation.value)}`);
                }
                debugLog?.('LAYER-USAGE', `${config.name}\n${JSON.stringify(usage)}`);
                return { value: validation.value, usage };
            }

            const attemptErrors = validation.errors ?? ['Unknown validation error'];
            allErrors.push(attemptErrors);
            debugLog?.('GENERATION-RETRY', `${config.name} attempt ${String(attempt + 1)} failed (${String(elapsedMs)}ms): ${attemptErrors.join('; ')}`);
        } catch (err: unknown) {
            const elapsedMs = Date.now() - attemptStart;
            const detail = formatError(err);

            // Fast failure (<2s) indicates an API-level error, not a content problem — apply backoff before next retry
            if (elapsedMs < 2000 && attempt < maxAttempts - 1) {
                const backoffMs = 2000 * Math.pow(2, attempt);
                debugLog?.('GENERATION-BACKOFF', `${config.name} attempt ${String(attempt + 1)} failed in ${String(elapsedMs)}ms (API error) — backing off ${String(backoffMs)}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }

            allErrors.push([`AI call failed (${String(elapsedMs)}ms): ${detail}`]);
            debugLog?.('GENERATION-RETRY', `${config.name} attempt ${String(attempt + 1)} crashed (${String(elapsedMs)}ms): ${detail}`);
        }
    }

    throw new LayerGenerationError(config.name, maxAttempts, allErrors);
}
