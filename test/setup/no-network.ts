import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll } from 'vitest';

const networkError = (api: string): Error =>
  new Error(
    `Deterministic tests forbid outbound network calls. Blocked via ${api}. ` +
      'Mock the dependency instead of making live requests.',
  );

type RequestFn = typeof http.request;
type GetFn = typeof http.get;
type FetchFn = typeof globalThis.fetch;

let originalHttpRequest: RequestFn | null = null;
let originalHttpsRequest: typeof https.request | null = null;
let originalHttpGet: GetFn | null = null;
let originalHttpsGet: typeof https.get | null = null;
let originalFetch: FetchFn = globalThis.fetch;

beforeAll(() => {
  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;
  originalHttpGet = http.get;
  originalHttpsGet = https.get;
  originalFetch = globalThis.fetch;

  (http.request as unknown as RequestFn) = ((..._args: Parameters<RequestFn>) => {
    throw networkError('http.request');
  }) as RequestFn;

  (https.request as unknown as typeof https.request) = ((
    ..._args: Parameters<typeof https.request>
  ) => {
    throw networkError('https.request');
  }) as typeof https.request;

  (http.get as unknown as GetFn) = ((..._args: Parameters<GetFn>) => {
    throw networkError('http.get');
  }) as GetFn;

  (https.get as unknown as typeof https.get) = ((..._args: Parameters<typeof https.get>) => {
    throw networkError('https.get');
  }) as typeof https.get;

  globalThis.fetch = (() => Promise.reject(networkError('fetch'))) as FetchFn;
});

afterAll(() => {
  if (originalHttpRequest) {
    (http.request as unknown as RequestFn) = originalHttpRequest;
  }
  if (originalHttpsRequest) {
    (https.request as unknown as typeof https.request) = originalHttpsRequest;
  }
  if (originalHttpGet) {
    (http.get as unknown as GetFn) = originalHttpGet;
  }
  if (originalHttpsGet) {
    (https.get as unknown as typeof https.get) = originalHttpsGet;
  }
  globalThis.fetch = originalFetch;
});
