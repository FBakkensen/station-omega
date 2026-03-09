import type { ModelMessage, ToolSet } from 'ai';
import type { ZodType } from 'zod';

export type AIProviderOptions = unknown;

export interface UsageData {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export type AIStreamPart =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolName: string; input: unknown }
  | { type: 'tool-result'; toolName: string; output: unknown }
  | { type: 'error'; error: unknown }
  | { type: string; [key: string]: unknown };

export interface AITextObjectStream<TSchema> {
  fullStream: AsyncIterable<AIStreamPart>;
  output: Promise<TSchema>;
  usage: Promise<UsageData>;
}

export interface StreamStructuredObjectRequest<TSchema> {
  modelId: string;
  system: string;
  schema: ZodType<TSchema>;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxOutputTokens?: number;
  stopAfterSteps?: number;
  disableToolsAfterStep?: number;
  abortSignal?: AbortSignal;
  providerOptions?: AIProviderOptions;
}

export interface AITextClient {
  streamStructuredObject<TSchema>(
    request: StreamStructuredObjectRequest<TSchema>,
  ): AITextObjectStream<TSchema>;
}
