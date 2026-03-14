import { describe, expect, it, vi } from 'vitest';
import { FalVideoClient } from './fal-video-client.js';
import { VIDEO_MODEL_ID, VIDEO_I2V_MODEL_ID } from '../model-catalog.js';

const noopSleep = () => Promise.resolve();

const QUEUE_BASE = `https://queue.fal.run/${VIDEO_MODEL_ID}`;
const I2V_QUEUE_BASE = `https://queue.fal.run/${VIDEO_I2V_MODEL_ID}`;

function submitBody(id: string) {
  return {
    request_id: id,
    status_url: `${QUEUE_BASE}/requests/${id}/status`,
    response_url: `${QUEUE_BASE}/requests/${id}`,
  };
}

function i2vSubmitBody(id: string) {
  return {
    request_id: id,
    status_url: `${I2V_QUEUE_BASE}/requests/${id}/status`,
    response_url: `${I2V_QUEUE_BASE}/requests/${id}`,
  };
}

function mockResponse(body: unknown, opts?: { ok?: boolean; status?: number; isArrayBuffer?: boolean }) {
  const ok = opts?.ok ?? true;
  const status = opts?.status ?? 200;
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(opts?.isArrayBuffer ? body : new ArrayBuffer(0)),
  } as unknown as Response;
}

describe('FalVideoClient', () => {

  it('[Z] returns empty video bytes when video has zero-length content', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_0')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(0), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'test' });
    expect(result.videoBytes).toHaveLength(0);
    expect(result.mimeType).toBe('video/mp4');
  });

  it('[O] completes successfully with one poll cycle', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_1')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4' } }))
      .mockResolvedValueOnce(mockResponse(new Uint8Array([1, 2, 3, 4]).buffer, { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'cinematic space station' });

    expect(result.videoBytes).toHaveLength(4);
    expect(result.mimeType).toBe('video/mp4');
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Verify auth header
    const submitInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect((submitInit.headers as Record<string, string>).Authorization).toBe('Key test-key');
  });

  it('[M] polls multiple times before completion', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_m')))
      .mockResolvedValueOnce(mockResponse({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(mockResponse({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(16), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'test' });

    expect(result.videoBytes).toHaveLength(16);
    // submit + 3 polls + result + download = 6
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it('[B] defaults mimeType to video/mp4 when content_type is absent at boundary', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_b')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'test' });
    expect(result.mimeType).toBe('video/mp4');
  });

  it('[I] sends correct URLs, auth headers, and omits Content-Type on GET requests', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_i')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalVideoClient('my-api-key', mockFetch, noopSleep);
    await client.generateVideo({ prompt: 'test prompt' });

    // Submit URL
    expect(mockFetch.mock.calls[0][0]).toBe(QUEUE_BASE);
    // Submit body
    const submitInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(submitInit.body as string)).toEqual({
      prompt: 'test prompt',
      duration: '5',
      aspect_ratio: '16:9',
      resolution: '480p',
    });
    // Poll URL (uses status_url from submit response, not constructed from base)
    expect(mockFetch.mock.calls[1][0]).toBe(
      `${QUEUE_BASE}/requests/req_i/status`,
    );
    // Result URL (uses response_url from submit response)
    expect(mockFetch.mock.calls[2][0]).toBe(
      `${QUEUE_BASE}/requests/req_i`,
    );
    // All auth headers
    for (let i = 0; i < 3; i++) {
      const init = mockFetch.mock.calls[i][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Key my-api-key');
    }

    // POST submit SHOULD have Content-Type
    const submitHeaders = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(submitHeaders['Content-Type']).toBe('application/json');

    // GET status poll should NOT have Content-Type
    const pollHeaders = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(pollHeaders['Content-Type']).toBeUndefined();

    // GET result fetch should NOT have Content-Type
    const resultHeaders = (mockFetch.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(resultHeaders['Content-Type']).toBeUndefined();
  });

  it('[E] throws on queue submit failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse('Internal Server Error', { ok: false, status: 500 }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await expect(client.generateVideo({ prompt: 'test' }))
      .rejects.toThrow('fal.ai video queue submit error (500)');
  });

  it('[E] throws on poll status HTTP error and stops polling', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_poll_err')))
      .mockResolvedValueOnce(mockResponse('Service Unavailable', { ok: false, status: 503 }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await expect(client.generateVideo({ prompt: 'test' }))
      .rejects.toThrow('fal.ai video status poll error (503)');

    // submit + 1 failed poll = 2 calls (no further polling)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('[E] throws when video generation fails in queue', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_fail')))
      .mockResolvedValueOnce(mockResponse({ status: 'FAILED' }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await expect(client.generateVideo({ prompt: 'test' }))
      .rejects.toThrow('fal.ai video generation failed');
  });

  it('[S] produces valid result with standard prompt and response', async () => {
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_s')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/video.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(videoData.buffer, { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'A space station in deep space' });

    expect(result.videoBytes).toEqual(videoData);
    expect(result.mimeType).toBe('video/mp4');
  });
});

describe('FalVideoClient image-to-video', () => {

  it('[Z] sends request without image_url in body when imageUrl is undefined', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(submitBody('req_z_i2v')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(0), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await client.generateVideo({ prompt: 'test' });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.image_url).toBeUndefined();
    // Should use text-to-video URL
    expect(mockFetch.mock.calls[0][0]).toBe(QUEUE_BASE);
  });

  it('[O] completes successfully with one poll cycle using image-to-video model', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(i2vSubmitBody('req_o_i2v')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new Uint8Array([1, 2, 3]).buffer, { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({ prompt: 'machinery activating', imageUrl: 'https://example.com/item.png' });

    expect(result.videoBytes).toHaveLength(3);
    expect(result.mimeType).toBe('video/mp4');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('[M] sends correct model URL for image-to-video vs text-to-video across multiple calls', async () => {
    const makeMocks = (submitFn: typeof submitBody | typeof i2vSubmitBody, id: string) => [
      mockResponse(submitFn(id)),
      mockResponse({ status: 'COMPLETED' }),
      mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }),
      mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }),
    ] as const;

    const [t2vSubmit, t2vStatus, t2vResult, t2vDownload] = makeMocks(submitBody, 't2v');
    const [i2vSubmit, i2vStatus, i2vResult, i2vDownload] = makeMocks(i2vSubmitBody, 'i2v');

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(t2vSubmit)
      .mockResolvedValueOnce(t2vStatus)
      .mockResolvedValueOnce(t2vResult)
      .mockResolvedValueOnce(t2vDownload)
      .mockResolvedValueOnce(i2vSubmit)
      .mockResolvedValueOnce(i2vStatus)
      .mockResolvedValueOnce(i2vResult)
      .mockResolvedValueOnce(i2vDownload);

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);

    // Text-to-video call
    await client.generateVideo({ prompt: 'text prompt' });
    expect(mockFetch.mock.calls[0][0]).toBe(QUEUE_BASE);

    // Image-to-video call
    await client.generateVideo({ prompt: 'image prompt', imageUrl: 'https://example.com/img.png' });
    expect(mockFetch.mock.calls[4][0]).toBe(I2V_QUEUE_BASE);
  });

  it('[B] includes image_url in body at the boundary between empty and non-empty imageUrl', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(i2vSubmitBody('req_b_i2v')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await client.generateVideo({ prompt: 'test', imageUrl: 'https://example.com/frame.png' });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.image_url).toBe('https://example.com/frame.png');
    expect(body.prompt).toBe('test');
    expect(body.duration).toBe('5');
  });

  it('[I] uses VIDEO_I2V_MODEL_ID endpoint URL when imageUrl is provided', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(i2vSubmitBody('req_i_i2v')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/v.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(new ArrayBuffer(4), { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await client.generateVideo({ prompt: 'machinery powers up', imageUrl: 'https://example.com/reactor.png' });

    const submitUrl = mockFetch.mock.calls[0][0] as string;
    expect(submitUrl).toContain(VIDEO_I2V_MODEL_ID);
    expect(submitUrl).toBe(I2V_QUEUE_BASE);
  });

  it('[E] throws on queue submit failure for image-to-video request', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse('Internal Server Error', { ok: false, status: 500 }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    await expect(client.generateVideo({ prompt: 'test', imageUrl: 'https://example.com/img.png' }))
      .rejects.toThrow('fal.ai video queue submit error (500)');
  });

  it('[S] produces valid video result with standard image-to-video prompt and image URL', async () => {
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(i2vSubmitBody('req_s_i2v')))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: { url: 'https://cdn.fal.ai/video.mp4', content_type: 'video/mp4' } }))
      .mockResolvedValueOnce(mockResponse(videoData.buffer, { isArrayBuffer: true }));

    const client = new FalVideoClient('test-key', mockFetch, noopSleep);
    const result = await client.generateVideo({
      prompt: 'A reactor core igniting with blue plasma flooding upward through transparent conduits',
      imageUrl: 'https://example.com/reactor-room.png',
    });

    expect(result.videoBytes).toEqual(videoData);
    expect(result.mimeType).toBe('video/mp4');
  });
});
