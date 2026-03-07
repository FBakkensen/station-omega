export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
}

export interface ImageGenerationResult {
  imageBytes: Uint8Array;
  mimeType: string;
}

export interface ImageClient {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
