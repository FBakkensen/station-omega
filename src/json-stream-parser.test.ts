import { describe, expect, it } from 'vitest';
import { StreamingSegmentParser } from './json-stream-parser.js';

describe('StreamingSegmentParser', () => {
  it('[Z] returns no segments for empty deltas', () => {
    const parser = new StreamingSegmentParser();
    expect(parser.push('')).toEqual([]);
  });

  it('[O] extracts one complete segment from a single chunk', () => {
    const parser = new StreamingSegmentParser();
    const segments = parser.push(
      '{"segments":[{"type":"narration","text":"hello","npcId":null,"crewName":null}]}',
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('hello');
  });

  it('[M] handles many chunk boundaries while preserving order', () => {
    const parser = new StreamingSegmentParser();
    const chunks = [
      '{"seg',
      'ments":[{"type":"narration","text":"alpha","npcId":null,"crewName":null},',
      '{"type":"dialogue","text":"beta","npcId":"npc_1","crewName":null}]}',
    ];
    const out = chunks.flatMap((chunk) => parser.push(chunk));
    expect(out.map((s) => s.text)).toEqual(['alpha', 'beta']);
  });

  it('[B] supports escaped braces and quotes in segment text', () => {
    const parser = new StreamingSegmentParser();
    const payload =
      '{"segments":[{"type":"narration","text":"status: \\"ok\\" {stable}","npcId":null,"crewName":null}]}';
    const [seg] = parser.push(payload);
    expect(seg.text).toBe('status: "ok" {stable}');
  });

  it('[I] preserves the GameSegment wire shape', () => {
    const parser = new StreamingSegmentParser();
    const [seg] = parser.push(
      '{"segments":[{"type":"crew_echo","text":"log entry","npcId":null,"crewName":"Mika"}]}',
    );
    expect(seg).toEqual({
      type: 'crew_echo',
      text: 'log entry',
      npcId: null,
      crewName: 'Mika',
    });
  });

  it('[E] skips malformed segment objects instead of throwing', () => {
    const parser = new StreamingSegmentParser();
    const out = parser.push('{"segments":[{"type":"narration","text":oops}]}');
    expect(out).toEqual([]);
  });

  it('[S] resets internal state cleanly between streamed responses', () => {
    const parser = new StreamingSegmentParser();
    parser.push('{"segments":[{"type":"narration","text":"first","npcId":null,"crewName":null}]}');
    parser.reset();
    const out = parser.push(
      '{"segments":[{"type":"narration","text":"second","npcId":null,"crewName":null}]}',
    );
    expect(out.map((s) => s.text)).toEqual(['second']);
  });
});
