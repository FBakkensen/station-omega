export interface VideoGenerationRequest {
  prompt: string;
}

export interface VideoGenerationResult {
  videoBytes: Uint8Array;
  mimeType: string;
}

export interface VideoClient {
  generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}
