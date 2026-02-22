import { OpenRouterAITextClient } from './io/openrouter-ai-client.js';

/** Model used for the main game master (tool calling + narrative). */
export const GAME_MASTER_MODEL_ID = 'google/gemini-3-flash-preview';

/** Model used for creative content generation (structured output only). */
export const CREATIVE_MODEL_ID = 'anthropic/claude-opus-4.6';

/** Shared default OpenRouter-backed AI client used by scripts and actions. */
export const defaultAITextClient = new OpenRouterAITextClient({
  apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  referer: 'https://github.com/station-omega',
  title: 'Station Omega',
});
