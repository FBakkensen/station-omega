import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Output, stepCountIs, streamText } from 'ai';
import type { OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { AITextClient, AITextObjectStream, StreamStructuredObjectRequest, UsageData } from './ai-text-client.js';

export interface OpenRouterAITextClientConfig {
  apiKey: string;
  referer?: string;
  title?: string;
}

type StreamTextOptions = Parameters<typeof streamText>[0];

export class OpenRouterAITextClient implements AITextClient {
  private readonly openrouter: OpenRouterProvider;

  constructor(config: OpenRouterAITextClientConfig) {
    this.openrouter = createOpenRouter({
      apiKey: config.apiKey,
      headers: {
        'HTTP-Referer': config.referer ?? 'https://github.com/station-omega',
        'X-Title': config.title ?? 'Station Omega',
      },
    });
  }

  streamStructuredObject<TSchema>(
    request: StreamStructuredObjectRequest<TSchema>,
  ): AITextObjectStream<TSchema> {
    const providerOptions = request.providerOptions as StreamTextOptions['providerOptions'] | undefined;

    const baseOptions = {
      model: this.openrouter(request.modelId),
      system: request.system,
      output: Output.object({ schema: request.schema }),
      temperature: request.temperature ?? 1.0,
      maxOutputTokens: request.maxOutputTokens ?? 8192,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    };
    const streamOptions: StreamTextOptions = request.messages
      ? { ...baseOptions, messages: request.messages }
      : { ...baseOptions, prompt: request.prompt ?? '' };

    if (typeof request.stopAfterSteps === 'number') {
      streamOptions.stopWhen = stepCountIs(request.stopAfterSteps);
    }

    const disableToolsAfterStep = request.disableToolsAfterStep;

    // Precompute action gating data (stable across steps)
    const actionGating = request.primaryActionTools ? {
      primarySet: new Set(request.primaryActionTools),
      observationOnly: Object.keys(request.tools ?? {}).filter(
        n => !new Set(request.primaryActionTools).has(n)
      ),
    } : null;

    if (typeof disableToolsAfterStep === 'number' || actionGating) {
      streamOptions.prepareStep = ({ stepNumber, steps }) => {
        // Final step: force structured output (existing behavior)
        if (typeof disableToolsAfterStep === 'number' && stepNumber >= disableToolsAfterStep) {
          return { toolChoice: 'none' as const, activeTools: [] };
        }
        // After a primary action tool was called, restrict to observation-only
        if (actionGating) {
          const primaryCalled = steps.some(step =>
            step.toolCalls.some(tc => actionGating.primarySet.has(tc.toolName))
          );
          if (primaryCalled) {
            return { activeTools: actionGating.observationOnly };
          }
        }
        return undefined;
      };
    }

    const result = streamText(streamOptions);

    // Usage promise — must only be awaited AFTER fullStream is fully consumed
    const usage: Promise<UsageData> = (async () => {
      const totalUsage = await result.totalUsage;
      const providerMeta = await result.providerMetadata;
      const openrouterUsage = providerMeta?.openrouter as Record<string, unknown> | undefined;
      const usageObj = openrouterUsage?.['usage'] as Record<string, unknown> | undefined;
      const costUsd = typeof usageObj?.['cost'] === 'number' ? usageObj['cost'] : undefined;
      return {
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
        costUsd,
      };
    })();

    return {
      fullStream: result.fullStream,
      output: Promise.resolve(result.output) as Promise<TSchema>,
      usage,
    };
  }
}
