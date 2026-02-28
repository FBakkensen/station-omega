import { describe, expect, it } from 'vitest';
import { extractCleanText, markdownToSpans, truncateSpans } from './markdownToSpans';
import type { StyledSpan } from './types';

describe('markdown span parsing contracts', () => {
  it('[Z] returns zero spans and empty content for empty markdown input', () => {
    const parsed = markdownToSpans('', '#7aa2ff');

    expect(parsed.spans).toEqual([]);
    expect(parsed.contentLength).toBe(0);
    expect(extractCleanText('')).toBe('');
  });

  it('[O] accepts one minimal inline format and preserves provided base color', () => {
    const parsed = markdownToSpans('**Core** online', '#00ffaa');

    expect(parsed.contentLength).toBe('Core online'.length);
    expect(parsed.spans.some((span) => span.text === 'Core' && span.bold === true)).toBe(true);
    expect(parsed.spans.some((span) => span.color === '#00ffaa')).toBe(true);
  });

  it('[M] preserves ordered content across many mixed block and inline markdown elements', () => {
    const markdown = [
      '# Reactor Deck',
      '',
      'Primary status: ~~unstable~~ **stable**',
      '',
      '- isolate loop',
      '- vent pressure',
      '',
      '> use manual override',
      '',
      '`CAL-22`',
    ].join('\n');

    const parsed = markdownToSpans(markdown, '#ffffff');
    const joined = parsed.spans.map((span) => span.text).join('');

    expect(joined.includes('Reactor Deck')).toBe(true);
    expect(joined.includes('isolate loop')).toBe(true);
    expect(joined.includes('vent pressure')).toBe(true);
    expect(joined.includes('manual override')).toBe(true);
    expect(joined.includes('CAL-22')).toBe(true);
    expect(joined.indexOf('isolate loop')).toBeLessThan(joined.indexOf('vent pressure'));
    expect(parsed.contentLength).toBe(joined.length);
  });

  it('[B] truncates spans at boundary limits without exceeding the requested character range', () => {
    const spans: StyledSpan[] = [
      { text: 'hello', color: '#fff' },
      { text: 'world', bold: true, color: '#fff' },
    ];

    expect(truncateSpans(spans, 0)).toEqual([]);
    expect(truncateSpans(spans, 5)).toEqual([{ text: 'hello', color: '#fff' }]);
    expect(truncateSpans(spans, 6)).toEqual([
      { text: 'hello', color: '#fff' },
      { text: 'w', bold: true, color: '#fff' },
    ]);
  });

  it('[I] preserves code span contract fields with code style and dedicated color mapping', () => {
    const parsed = markdownToSpans('Use `diag` now', '#44ccaa');
    const codeSpan = parsed.spans.find((span) => span.text === 'diag');

    expect(codeSpan).toBeDefined();
    expect(codeSpan?.code).toBe(true);
    expect(codeSpan?.color).toBe('#ff8844');
    expect(codeSpan?.bold).toBeUndefined();
  });

  it('[E] tolerates malformed markdown safely without throwing parser errors', () => {
    expect(() => markdownToSpans('**unclosed and [broken](link', '#cccccc')).not.toThrow();
    expect(() => extractCleanText('**unclosed and [broken](link')).not.toThrow();

    const parsed = markdownToSpans('**unclosed and [broken](link', '#cccccc');
    expect(parsed.contentLength).toBeGreaterThan(0);
  });

  it('[S] follows standard extraction flow by returning plain text with normalized spacing', () => {
    const text = extractCleanText([
      'I **check** the panel.',
      '',
      '- isolate loop',
      '- vent pressure',
      '',
      '`CAL-22` online',
    ].join('\n'));

    expect(text).toBe('I check the panel. isolate loop vent pressure CAL-22 online');
  });
});
