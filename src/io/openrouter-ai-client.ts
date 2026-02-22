import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Output, stepCountIs, streamText } from 'ai';
import type { OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { AITextClient, AITextObjectStream, StreamStructuredObjectRequest } from './ai-text-client.js';

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
    if (typeof disableToolsAfterStep === 'number') {
      streamOptions.prepareStep = ({ stepNumber }) => {
        if (stepNumber >= disableToolsAfterStep) {
          return { toolChoice: 'none' as const, activeTools: [] };
        }
        return undefined;
      };
    }

    const result = streamText(streamOptions);
    return {
      fullStream: result.fullStream,
      output: Promise.resolve(result.output) as Promise<TSchema>,
    };
  }
}
