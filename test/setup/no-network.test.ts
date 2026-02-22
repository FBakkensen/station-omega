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

  it('[B] blocks named node:http request', () => {
    expect(() => httpRequestNamed('http://example.com')).toThrow('Blocked via http.request');
  });

  it('[I] blocks https.request', () => {
    expect(() => https.request('https://example.com')).toThrow('Blocked via https.request');
  });

  it('[E] blocks named node:https request', () => {
    expect(() => httpsRequestNamed('https://example.com')).toThrow('Blocked via https.request');
  });

  it('[S] blocks http.get', () => {
    expect(() => http.get('http://example.com')).toThrow('Blocked via http.get');
  });

  it('blocks named node:http get', () => {
    expect(() => httpGetNamed('http://example.com')).toThrow('Blocked via http.get');
  });

  it('blocks https.get', () => {
    expect(() => https.get('https://example.com')).toThrow('Blocked via https.get');
  });

  it('blocks named node:https get', () => {
    expect(() => httpsGetNamed('https://example.com')).toThrow('Blocked via https.get');
  });

  it('blocks fetch', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('Blocked via fetch');
  });

  it('blocks net.connect', () => {
    expect(() => net.connect({ host: 'example.com', port: 80 })).toThrow('Blocked via net.connect');
  });

  it('blocks net.createConnection', () => {
    expect(() => net.createConnection({ host: 'example.com', port: 80 })).toThrow(
      'Blocked via net.createConnection',
    );
  });

  it('blocks tls.connect', () => {
    expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(
      'Blocked via tls.connect',
    );
  });
});
