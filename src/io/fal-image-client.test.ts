import { describe, expect, it, vi } from 'vitest';
import { FalImageClient } from './fal-image-client.js';
import { IMAGE_MODEL_ID } from '../model-catalog.js';

const API_BASE = `https://fal.run/${IMAGE_MODEL_ID}`;

function mockResponse(body: unknown, opts?: { ok?: boolean; status?: number; isArrayBuffer?: boolean }) {
  const ok = opts?.ok ?? true;
  const status = opts?.status ?? 200;
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(opts?.isArrayBuffer ? body : new ArrayBuffer(0)),
  } as unknown as Response;
}

describe('FalImageClient', () => {
  it('[Z] returns empty image bytes when download content is zero-length', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png', content_type: 'image/png' }], seed: 11 }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(0), { isArrayBuffer: true }));

    const client = new FalImageClient('test-key', mockFetch);
    const result = await client.generateImage({ prompt: 'test', width: 512, height: 512 });

    expect(result.imageBytes).toHaveLength(0);
    expect(result.mimeType).toBe('image/png');
    expect(result.seed).toBe(11);
  });

  it('[O] completes successfully with one image response and seed', async () => {
    const imageData = new Uint8Array([1, 2, 3]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png', content_type: 'image/png' }], seed: 42 }))
      .mockResolvedValueOnce(mockResponse(imageData.buffer, { isArrayBuffer: true }));

    const client = new FalImageClient('test-key', mockFetch);
    const result = await client.generateImage({ prompt: 'orbital platform', width: 640, height: 512 });

    expect(result.imageBytes).toEqual(imageData);
    expect(result.seed).toBe(42);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('[M] sends many optional control parameters together when provided', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png' }], seed: 7 }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalImageClient('test-key', mockFetch);
    await client.generateImage({
      prompt: 'medical kit in airlock',
      width: 1280,
      height: 512,
      guidanceScale: 6,
      seed: 1234,
      enablePromptExpansion: false,
    });

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: 'medical kit in airlock',
      image_size: {
        width: 1280,
        height: 512,
      },
      num_images: 1,
      enable_safety_checker: false,
      guidance_scale: 6,
      seed: 1234,
      enable_prompt_expansion: false,
    });
  });

  it('[B] defaults mimeType to image/png when content_type is absent at boundary', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png' }], seed: 9 }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalImageClient('test-key', mockFetch);
    const result = await client.generateImage({ prompt: 'test', width: 512, height: 512 });

    expect(result.mimeType).toBe('image/png');
  });

  it('[I] sends correct URL, auth header, and request contract', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png', content_type: 'image/png' }], seed: 99 }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalImageClient('my-api-key', mockFetch);
    await client.generateImage({ prompt: 'exact room prompt', width: 896, height: 512, guidanceScale: 3.5 });

    expect(mockFetch.mock.calls[0][0]).toBe(API_BASE);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Key my-api-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt: 'exact room prompt',
      image_size: { width: 896, height: 512 },
      guidance_scale: 3.5,
    });
  });

  it('[E] throws on fal.ai API error', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse('bad request', { ok: false, status: 400 }));

    const client = new FalImageClient('test-key', mockFetch);
    await expect(client.generateImage({ prompt: 'test', width: 512, height: 512 }))
      .rejects.toThrow('fal.ai API error (400): bad request');
  });

  it('[S] produces valid result with standard prompt and download', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ images: [{ url: 'https://cdn.fal.ai/image.png', content_type: 'image/png' }], seed: 31415 }))
      .mockResolvedValueOnce(mockResponse(imageData.buffer, { isArrayBuffer: true }));

    const client = new FalImageClient('test-key', mockFetch);
    const result = await client.generateImage({ prompt: 'A room-faithful field dressing kit', width: 1280, height: 512 });

    expect(result.imageBytes).toEqual(imageData);
    expect(result.mimeType).toBe('image/png');
    expect(result.seed).toBe(31415);
  });
});
