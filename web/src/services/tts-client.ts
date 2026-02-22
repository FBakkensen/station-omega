export interface TTSProxyRequest {
  text: string;
  voiceId: string;
  temperature: number;
  speakingRate: number;
}

export async function requestTTSAudio(
  ttsProxyUrl: string,
  request: TTSProxyRequest,
  signal: AbortSignal,
): Promise<ArrayBuffer | null> {
  const response = await fetch(ttsProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) return null;
  return response.arrayBuffer();
}
