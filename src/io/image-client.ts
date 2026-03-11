export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
  /** Prompt adherence (0–20). Lower = more creative, higher = more literal. */
  guidanceScale?: number;
  /** Seed for reproducibility. */
  seed?: number;
  /** Whether to let the model expand/rewrite the prompt. */
  enablePromptExpansion?: boolean;
}

export interface ImageGenerationResult {
  imageBytes: Uint8Array;
  mimeType: string;
  /** Seed used for generation (returned by fal.ai). */
  seed?: number;
}

export interface ImageClient {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
