import { describe, expect, it } from 'vitest';

describe('web no-network test setup', () => {
  it('[Z][O][M][B][I][E][S] blocks fetch in web tests', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('Blocked via fetch');
  });

  it('blocks XMLHttpRequest open in web tests', () => {
    const xhr = new XMLHttpRequest();
    expect(() => {
      xhr.open('GET', 'https://example.com');
    }).toThrow('Blocked via XMLHttpRequest.open');
  });
});
