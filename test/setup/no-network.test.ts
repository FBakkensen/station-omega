import http from 'node:http';
import https from 'node:https';
import { get as httpGetNamed, request as httpRequestNamed } from 'node:http';
import { get as httpsGetNamed, request as httpsRequestNamed } from 'node:https';
import { describe, expect, it } from 'vitest';

describe('no-network test setup', () => {
  it('blocks http.request', () => {
    expect(() => http.request('http://example.com')).toThrow('Blocked via http.request');
  });

  it('blocks named node:http request', () => {
    expect(() => httpRequestNamed('http://example.com')).toThrow('Blocked via http.request');
  });

  it('blocks https.request', () => {
    expect(() => https.request('https://example.com')).toThrow('Blocked via https.request');
  });

  it('blocks named node:https request', () => {
    expect(() => httpsRequestNamed('https://example.com')).toThrow('Blocked via https.request');
  });

  it('blocks http.get', () => {
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
});
