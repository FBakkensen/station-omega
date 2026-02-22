import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll } from 'vitest';

const networkError = (api: string): Error =>
  new Error(
    `Deterministic tests forbid outbound network calls. Blocked via ${api}. ` +
      'Mock the dependency instead of making live requests.',
  );

type RequestFn = typeof http.request;
type FetchFn = typeof globalThis.fetch;

let originalHttpRequest: RequestFn | null = null;
let originalHttpsRequest: typeof https.request | null = null;
let originalFetch: FetchFn = globalThis.fetch;

beforeAll(() => {
  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;
  originalFetch = globalThis.fetch;

  (http.request as unknown as RequestFn) = ((..._args: Parameters<RequestFn>) => {
    throw networkError('http.request');
  }) as RequestFn;

  (https.request as unknown as typeof https.request) = ((
    ..._args: Parameters<typeof https.request>
  ) => {
    throw networkError('https.request');
  }) as typeof https.request;

  globalThis.fetch = (() => Promise.reject(networkError('fetch'))) as FetchFn;
});

afterAll(() => {
  if (originalHttpRequest) {
    (http.request as unknown as RequestFn) = originalHttpRequest;
  }
  if (originalHttpsRequest) {
    (https.request as unknown as typeof https.request) = originalHttpsRequest;
  }
  globalThis.fetch = originalFetch;
});
