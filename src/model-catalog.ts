export interface ModelOption {
  id: string;
  label: string;
}

/** Available station generation models (extensible — add new entries here). */
export const GENERATION_MODELS: readonly ModelOption[] = [
  { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
];

// ─── Generation Model Tiers ──────────────────────────────────────────────────

export interface GenerationModelTiers {
    /** Core narrative: identity, objectives, room prose, arrival, NPCs */
    premium: string;
    /** Structured creative: item names/descriptions */
    mid: string;
    /** Mechanical content: room names, sensory details, engineering notes */
    cheap: string;
}

/** Change any tier's model in this one place. */
export const GENERATION_MODEL_TIERS: GenerationModelTiers = {
    premium: 'anthropic/claude-opus-4.6',
    mid: 'z-ai/glm-5',
    cheap: 'google/gemini-3.1-flash-lite-preview',
};

/** Default model used for station generation (alias to premium tier). */
export const GENERATION_MODEL_ID = GENERATION_MODEL_TIERS.premium;

/** Available game master models (extensible — add new entries here). */
export const GAME_MASTER_MODELS: readonly ModelOption[] = [
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
];

/** Default model used for the main game master (tool calling + narrative). */
export const GAME_MASTER_MODEL_ID = GAME_MASTER_MODELS[0].id;

/** Check whether a model ID is in the generation allowlist. */
export function isValidGenerationModelId(modelId: string): boolean {
  return GENERATION_MODELS.some(m => m.id === modelId) ||
    Object.values(GENERATION_MODEL_TIERS).includes(modelId);
}

/** Check whether a model ID is in the game master allowlist. */
export function isValidGameMasterModelId(modelId: string): boolean {
  return GAME_MASTER_MODELS.some(m => m.id === modelId);
}

// ─── TTS ─────────────────────────────────────────────────────────────────────
export const TTS_MODEL_ID = 'inworld-tts-1.5-max';

// ─── Image Generation ────────────────────────────────────────────────────────
export const IMAGE_MODEL_ID = 'fal-ai/flux/schnell';

// ─── Video Generation ────────────────────────────────────────────────────────
export const VIDEO_MODEL_ID = 'fal-ai/bytedance/seedance/v1/pro/fast/text-to-video';
