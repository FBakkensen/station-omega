import { describe, expect, it } from 'vitest';

describe('web no-network test setup', () => {
  it('[Z] blocks fetch in zero-network web tests', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('Blocked via fetch');
  });

  it('[O] blocks one explicit XMLHttpRequest open call', () => {
    const xhr = new XMLHttpRequest();
    expect(() => {
      xhr.open('GET', 'https://example.com');
    }).toThrow('Blocked via XMLHttpRequest.open');
  });

  it('[M] blocks many fetch attempts in sequence', async () => {
    const outcomes = await Promise.allSettled(
      ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'].map((url) =>
        fetch(url),
      ),
    );

    expect(outcomes).toHaveLength(3);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(String(outcome.reason)).toContain('Blocked via fetch');
      }
    }
  });

  it('[B] blocks fetch on localhost boundary URLs', async () => {
    await expect(fetch('http://localhost:5173/health')).rejects.toThrow('Blocked via fetch');
  });

  it('[I] preserves the XMLHttpRequest.open interface contract while blocking', () => {
    const xhr = new XMLHttpRequest();
    expect(typeof xhr.open).toBe('function');
    expect(() => {
      xhr.open('POST', 'https://example.com');
    }).toThrow('Blocked via XMLHttpRequest.open');
  });

  it('[E] returns a clear blocked error for fetch rejections', async () => {
    await expect(fetch('https://example.com/error-path')).rejects.toThrow(/Blocked via fetch/);
  });

  it('[S] follows standard blocking behavior for repeated XMLHttpRequest usage', () => {
    const xhr = new XMLHttpRequest();
    expect(() => {
      xhr.open('GET', 'https://example.com/first');
    }).toThrow('Blocked via XMLHttpRequest.open');
    expect(() => {
      xhr.open('GET', 'https://example.com/second');
    }).toThrow('Blocked via XMLHttpRequest.open');
  });
});
