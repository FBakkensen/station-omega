import { OpenRouterAITextClient } from './io/openrouter-ai-client.js';

// Re-export browser-safe catalog (no AI client, no process.env)
export {
  GENERATION_MODELS,
  GENERATION_MODEL_ID,
  GAME_MASTER_MODELS,
  GAME_MASTER_MODEL_ID,
  isValidGenerationModelId,
  isValidGameMasterModelId,
} from './model-catalog.js';
export type { ModelOption } from './model-catalog.js';

/** Shared default OpenRouter-backed AI client used by scripts and actions. */
let _defaultAITextClient: OpenRouterAITextClient | undefined;
export function getDefaultAITextClient(): OpenRouterAITextClient {
  if (!_defaultAITextClient) {
    _defaultAITextClient = new OpenRouterAITextClient({
      apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
      referer: 'https://github.com/station-omega',
      title: 'Station Omega',
    });
  }
  return _defaultAITextClient;
}

