export interface ModelOption {
  id: string;
  label: string;
}

/** Available station generation models (extensible — add new entries here). */
export const GENERATION_MODELS: readonly ModelOption[] = [
  { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
];

/** Default model used for station generation. */
export const GENERATION_MODEL_ID = GENERATION_MODELS[0].id;

/** Available game master models (extensible — add new entries here). */
export const GAME_MASTER_MODELS: readonly ModelOption[] = [
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
];

/** Default model used for the main game master (tool calling + narrative). */
export const GAME_MASTER_MODEL_ID = GAME_MASTER_MODELS[0].id;

/** Check whether a model ID is in the generation allowlist. */
export function isValidGenerationModelId(modelId: string): boolean {
  return GENERATION_MODELS.some(m => m.id === modelId);
}

/** Check whether a model ID is in the game master allowlist. */
export function isValidGameMasterModelId(modelId: string): boolean {
  return GAME_MASTER_MODELS.some(m => m.id === modelId);
}
