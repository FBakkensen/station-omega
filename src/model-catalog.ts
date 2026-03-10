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
    mid: 'anthropic/claude-sonnet-4.6',
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

/** Check whether a model ID is in the generation allowlist (premium tier only). */
export function isValidGenerationModelId(modelId: string): boolean {
  return GENERATION_MODELS.some(m => m.id === modelId) ||
    modelId === GENERATION_MODEL_TIERS.premium;
}

/** Check whether a model ID is in the game master allowlist. */
export function isValidGameMasterModelId(modelId: string): boolean {
  return GAME_MASTER_MODELS.some(m => m.id === modelId);
}

// ─── TTS ─────────────────────────────────────────────────────────────────────
export const TTS_MODEL_ID = 'inworld-tts-1.5-max';
/** Inworld TTS-1.5 Max: $10/M characters. */
export const TTS_COST_PER_CHAR = 10 / 1_000_000;

// ─── Image Generation ────────────────────────────────────────────────────────
export const IMAGE_MODEL_ID = 'fal-ai/flux-2/turbo';
/** FAL Flux 2 Turbo: $0.008 per megapixel (512×512 rounds to 1MP). */
export const IMAGE_COST_USD = 0.008;

// ─── Video Generation ────────────────────────────────────────────────────────
export const VIDEO_MODEL_ID = 'fal-ai/bytedance/seedance/v1/pro/fast/text-to-video';
/** FAL SeedDance Pro Fast: ~$0.048 per video (480p, 5s). */
export const VIDEO_COST_USD = 0.048;

export const VIDEO_I2V_MODEL_ID = 'fal-ai/bytedance/seedance/v1/pro/image-to-video';
/** FAL SeedDance Pro image-to-video: ~$0.12 per video (480p, 5s). */
export const VIDEO_I2V_COST_USD = 0.12;
