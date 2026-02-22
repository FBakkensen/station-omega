import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { afterAll } from 'vitest';

const networkError = (api: string): Error =>
  new Error(
    `Deterministic tests forbid outbound network calls. Blocked via ${api}. ` +
      'Mock the dependency instead of making live requests.',
  );

type RequestFn = typeof http.request;
type GetFn = typeof http.get;
type FetchFn = typeof globalThis.fetch;
type NetConnectFn = typeof net.connect;
type NetCreateConnectionFn = typeof net.createConnection;
type TlsConnectFn = typeof tls.connect;
type NoNetworkGlobal = typeof globalThis & {
  __stationOmegaNoNetworkInstalled?: boolean;
};

let originalHttpRequest: RequestFn | null = null;
let originalHttpsRequest: typeof https.request | null = null;
let originalHttpGet: GetFn | null = null;
let originalHttpsGet: typeof https.get | null = null;
let originalFetch: FetchFn = globalThis.fetch;
let originalNetConnect: NetConnectFn | null = null;
let originalNetCreateConnection: NetCreateConnectionFn | null = null;
let originalTlsConnect: TlsConnectFn | null = null;
let installed = false;

const installNoNetworkGuards = (): void => {
  if (installed) return;

  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;
  originalHttpGet = http.get;
  originalHttpsGet = https.get;
  originalFetch = globalThis.fetch;
  originalNetConnect = net.connect;
  originalNetCreateConnection = net.createConnection;
  originalTlsConnect = tls.connect;

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

  (net.connect as unknown as NetConnectFn) = ((..._args: unknown[]) => {
    throw networkError('net.connect');
  }) as unknown as NetConnectFn;

  (net.createConnection as unknown as NetCreateConnectionFn) = ((..._args: unknown[]) => {
    throw networkError('net.createConnection');
  }) as unknown as NetCreateConnectionFn;

  (tls.connect as unknown as TlsConnectFn) = ((..._args: unknown[]) => {
    throw networkError('tls.connect');
  }) as unknown as TlsConnectFn;

  // Keep `import { request/get } from 'node:http|https'` in sync with patched exports.
  syncBuiltinESMExports();

  globalThis.fetch = (() => Promise.reject(networkError('fetch'))) as FetchFn;
  (globalThis as NoNetworkGlobal).__stationOmegaNoNetworkInstalled = true;
  installed = true;
};

const restoreNoNetworkGuards = (): void => {
  if (!installed) return;

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
  if (originalNetConnect) {
    (net.connect as unknown as NetConnectFn) = originalNetConnect;
  }
  if (originalNetCreateConnection) {
    (net.createConnection as unknown as NetCreateConnectionFn) = originalNetCreateConnection;
  }
  if (originalTlsConnect) {
    (tls.connect as unknown as TlsConnectFn) = originalTlsConnect;
  }
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  delete (globalThis as NoNetworkGlobal).__stationOmegaNoNetworkInstalled;
  installed = false;
};

// Install immediately so import-time side effects in test files are blocked.
installNoNetworkGuards();

afterAll(() => {
  restoreNoNetworkGuards();
});
