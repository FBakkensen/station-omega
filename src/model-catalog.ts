export interface GameMasterModel {
  id: string;
  label: string;
}

/** Available game master models (extensible — add new entries here). */
export const GAME_MASTER_MODELS: readonly GameMasterModel[] = [
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
];

/** Default model used for the main game master (tool calling + narrative). */
export const GAME_MASTER_MODEL_ID = GAME_MASTER_MODELS[0].id;

/** Model used for creative content generation (structured output only). */
export const CREATIVE_MODEL_ID = 'anthropic/claude-opus-4.6';

/** Check whether a model ID is in the game master allowlist. */
export function isValidGameMasterModelId(modelId: string): boolean {
  return GAME_MASTER_MODELS.some(m => m.id === modelId);
}
