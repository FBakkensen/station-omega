import type { ImageClient, ImageGenerationRequest, ImageGenerationResult } from './image-client.js';

const FAL_API_BASE = 'https://fal.run/fal-ai/flux/schnell';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class FalImageClient implements ImageClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const response = await this.fetchFn(FAL_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: request.prompt,
        image_size: {
          width: request.width,
          height: request.height,
        },
        num_images: 1,
        enable_safety_checker: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`fal.ai API error (${String(response.status)}): ${errorText}`);
    }

    const result = await response.json() as {
      images: Array<{ url: string; content_type?: string }>;
    };

    if (result.images.length === 0) {
      throw new Error('fal.ai returned no images');
    }

    const imageUrl = result.images[0].url;
    const imageResponse = await this.fetchFn(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${String(imageResponse.status)}`);
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return {
      imageBytes: new Uint8Array(arrayBuffer),
      mimeType: result.images[0].content_type ?? 'image/jpeg',
    };
  }
}
