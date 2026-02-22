export interface TTSRequest {
  text: string;
  voiceId: string;
  temperature: number;
  speakingRate: number;
}

export type TTSResult =
  | { ok: true; wavBase64: string }
  | { ok: false; error: string; status: number };

export interface TTSClient {
  generateSpeech(request: TTSRequest): Promise<TTSResult>;
}
