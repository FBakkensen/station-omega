import { beforeAll, describe, expect, it, vi } from 'vitest';

type RouteDef = {
  path: string;
  method: string;
  handler: (ctx: { runAction: (ref: unknown, args: unknown) => Promise<unknown> }, request: Request) => Promise<Response>;
};

const httpMocks = vi.hoisted(() => ({
  routes: [] as RouteDef[],
  generateTTSToken: Symbol('generateTTS'),
}));

vi.mock('convex/server', () => ({
  httpRouter: () => ({
    route: (def: RouteDef) => {
      httpMocks.routes.push(def);
    },
  }),
}));

vi.mock('./_generated/server', () => ({
  httpAction: (
    fn: (ctx: { runAction: (ref: unknown, args: unknown) => Promise<unknown> }, request: Request) => Promise<Response>,
  ) => fn,
}));

vi.mock('./_generated/api', () => ({
  internal: {
    actions: {
      ttsProxy: {
        generateTTS: httpMocks.generateTTSToken,
      },
    },
  },
}));

let routes: RouteDef[] = [];

function findRoute(routes: RouteDef[], method: 'POST' | 'OPTIONS'): RouteDef {
  const match = routes.find((route) => route.path === '/api/tts' && route.method === method);
  if (!match) throw new Error(`Expected /api/tts ${method} route`);
  return match;
}

describe('http /api/tts endpoint contracts', () => {
  beforeAll(async () => {
    await import('./http');
    routes = [...httpMocks.routes];
  });

  it('[Z] returns 204 preflight response for zero-body OPTIONS requests', async () => {
    const optionsRoute = findRoute(routes, 'OPTIONS');

    const response = await optionsRoute.handler(
      { runAction: vi.fn() },
      new Request('http://localhost/api/tts', { method: 'OPTIONS' }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('[O] returns one successful audio response for one valid POST payload', async () => {
    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi.fn().mockResolvedValue({
        ok: true,
        wavBase64: Buffer.from('abc').toString('base64'),
      }),
    };

    const response = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test line',
          voiceId: 'Alex',
          temperature: 1,
          speakingRate: 1,
        }),
      }),
    );

    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
    expect(response.headers.get('Content-Length')).toBe('3');
    expect([...body]).toEqual([...Buffer.from('abc')]);
  });

  it('[M] handles many sequential POST calls with independent runAction outcomes', async () => {
    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, wavBase64: Buffer.from('first').toString('base64') })
        .mockResolvedValueOnce({ ok: true, wavBase64: Buffer.from('second').toString('base64') }),
    };

    const first = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'A', voiceId: 'Alex', temperature: 1, speakingRate: 1 }),
      }),
    );
    const second = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'B', voiceId: 'Ronald', temperature: 1, speakingRate: 1 }),
      }),
    );

    expect(new TextDecoder().decode(await first.arrayBuffer())).toBe('first');
    expect(new TextDecoder().decode(await second.arrayBuffer())).toBe('second');
    expect(ctx.runAction).toHaveBeenCalledTimes(2);
  });

  it('[B] keeps boundary behavior stable for empty decoded WAV payloads', async () => {
    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi.fn().mockResolvedValue({ ok: true, wavBase64: '' }),
    };

    const response = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'Boundary', voiceId: 'Alex', temperature: 0, speakingRate: 0.5 }),
      }),
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('0');
    expect(bytes.byteLength).toBe(0);
  });

  it('[I] preserves router registration and runAction payload interface contracts', async () => {
    expect(routes.map((route) => `${route.method}:${route.path}`).sort()).toEqual([
      'OPTIONS:/api/tts',
      'POST:/api/tts',
    ]);

    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi.fn().mockResolvedValue({ ok: true, wavBase64: Buffer.from('ok').toString('base64') }),
    };
    const payload = {
      text: 'Route power',
      voiceId: 'Elizabeth',
      temperature: 0.4,
      speakingRate: 1.1,
    };

    await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );

    expect(ctx.runAction).toHaveBeenCalledWith(httpMocks.generateTTSToken, payload);
  });

  it('[E] returns explicit 500 diagnostics when handler throws during processing', async () => {
    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi.fn().mockRejectedValue(new Error('downstream exploded')),
    };

    const response = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'Fail', voiceId: 'Alex', temperature: 1, speakingRate: 1 }),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('downstream exploded');
  });

  it('[S] follows standard upstream-error flow by surfacing proxy status and error JSON', async () => {
    const postRoute = findRoute(routes, 'POST');
    const ctx = {
      runAction: vi.fn().mockResolvedValue({
        ok: false,
        error: 'TTS not configured',
        status: 503,
      }),
    };

    const response = await postRoute.handler(
      ctx,
      new Request('http://localhost/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'Proxy error', voiceId: 'Alex', temperature: 1, speakingRate: 1 }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({ error: 'TTS not configured' });
  });
});
