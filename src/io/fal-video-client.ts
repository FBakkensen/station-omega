import type { VideoClient, VideoGenerationRequest, VideoGenerationResult } from './video-client.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run/fal-ai/veo3.1/fast';

const POLL_INITIAL_MS = 5_000;
const POLL_MAX_MS = 15_000;

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

interface QueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface QueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

interface QueueResultResponse {
  video: { url: string; content_type?: string };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export class FalVideoClient implements VideoClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = globalThis.fetch,
    private readonly sleepFn: SleepFn = defaultSleep,
  ) {}

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const authHeaders = { Authorization: `Key ${this.apiKey}` };
    const postHeaders = { ...authHeaders, 'Content-Type': 'application/json' };

    // Submit to queue
    const submitResponse = await this.fetchFn(FAL_QUEUE_BASE, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({
        prompt: request.prompt,
        duration: '8s',
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: true,
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text().catch(() => 'unknown error');
      throw new Error(`fal.ai video queue submit error (${String(submitResponse.status)}): ${errorText}`);
    }

    const { status_url, response_url } = await submitResponse.json() as QueueSubmitResponse;

    // Poll for completion (no client-side timeout; Convex action timeout governs)
    let delay = POLL_INITIAL_MS;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      await this.sleepFn(delay);
      delay = Math.min(delay * 1.5, POLL_MAX_MS);

      const statusResponse = await this.fetchFn(
        status_url,
        { headers: authHeaders },
      );

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text().catch(() => 'unknown error');
        throw new Error(`fal.ai video status poll error (${String(statusResponse.status)}): ${errorText}`);
      }

      const statusResult = await statusResponse.json() as QueueStatusResponse;

      if (statusResult.status === 'FAILED') {
        throw new Error('fal.ai video generation failed');
      }

      if (statusResult.status === 'COMPLETED') {
        break;
      }
    }

    // Fetch result
    const resultResponse = await this.fetchFn(
      response_url,
      { headers: authHeaders },
    );

    if (!resultResponse.ok) {
      const errorText = await resultResponse.text().catch(() => 'unknown error');
      throw new Error(`fal.ai video result fetch error (${String(resultResponse.status)}): ${errorText}`);
    }

    const result = await resultResponse.json() as QueueResultResponse;

    if (!result.video.url) {
      throw new Error('fal.ai returned no video');
    }

    // Download video bytes
    const videoResponse = await this.fetchFn(result.video.url);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download generated video: ${String(videoResponse.status)}`);
    }

    const arrayBuffer = await videoResponse.arrayBuffer();
    return {
      videoBytes: new Uint8Array(arrayBuffer),
      mimeType: result.video.content_type ?? 'video/mp4',
    };
  }
}
