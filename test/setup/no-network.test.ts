import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { get as httpGetNamed, request as httpRequestNamed } from 'node:http';
import { get as httpsGetNamed, request as httpsRequestNamed } from 'node:https';
import { describe, expect, it } from 'vitest';

const importTimeHttpSideEffectError = await import('./fixtures/import-time-http-side-effect')
  .then(() => null)
  .catch((error: unknown) => error);

const importTimeFetchSideEffectError = await import('./fixtures/import-time-fetch-side-effect')
  .then(() => null)
  .catch((error: unknown) => error);

describe('no-network test setup', () => {
  it('[Z] blocks import-time http side effects before test hooks run', () => {
    expect(importTimeHttpSideEffectError).toBeNull();
  });

  it('[O] blocks import-time fetch side effects before test hooks run', () => {
    expect(importTimeFetchSideEffectError).toBeNull();
  });

  it('[M] blocks http.request', () => {
    expect(() => http.request('http://example.com')).toThrow('Blocked via http.request');
  });

  it('[B] blocks named node:http request on a boundary alias path', () => {
    expect(() => httpRequestNamed('http://example.com')).toThrow('Blocked via http.request');
  });

  it('[I] blocks https.request', () => {
    expect(() => https.request('https://example.com')).toThrow('Blocked via https.request');
  });

  it('[E] blocks named node:https request', () => {
    expect(() => httpsRequestNamed('https://example.com')).toThrow('Blocked via https.request');
  });

  it('[S] blocks http.get in standard no-network mode', () => {
    expect(() => http.get('http://example.com')).toThrow('Blocked via http.get');
  });

  it('[M] blocks multiple node:http get aliases', () => {
    expect(() => httpGetNamed('http://example.com')).toThrow('Blocked via http.get');
  });

  it('[B] blocks https.get on a boundary transport path', () => {
    expect(() => https.get('https://example.com')).toThrow('Blocked via https.get');
  });

  it('[I] blocks named node:https get interface aliases', () => {
    expect(() => httpsGetNamed('https://example.com')).toThrow('Blocked via https.get');
  });

  it('[E] blocks fetch with an explicit error path', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('Blocked via fetch');
  });

  it('[S] blocks standard net.connect usage', () => {
    expect(() => net.connect({ host: 'example.com', port: 80 })).toThrow('Blocked via net.connect');
  });

  it('[O] blocks one net.createConnection alias', () => {
    expect(() => net.createConnection({ host: 'example.com', port: 80 })).toThrow(
      'Blocked via net.createConnection',
    );
  });

  it('[Z] blocks tls.connect when zero outbound network is allowed', () => {
    expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(
      'Blocked via tls.connect',
    );
  });
});
