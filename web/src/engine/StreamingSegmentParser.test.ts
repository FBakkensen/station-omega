import { describe, expect, it } from 'vitest';
import { StreamingSegmentParser } from './StreamingSegmentParser';

describe('web StreamingSegmentParser contracts', () => {
  it('[Z] returns zero segments for empty input deltas', () => {
    const parser = new StreamingSegmentParser();
    expect(parser.push('')).toEqual([]);
  });

  it('[O] extracts one complete segment from one well-formed payload', () => {
    const parser = new StreamingSegmentParser();
    const out = parser.push(
      '{"segments":[{"type":"narration","text":"hello","npcId":null,"crewName":null}]}',
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: 'narration',
      text: 'hello',
      npcId: null,
      crewName: null,
    });
  });

  it('[M] extracts many ordered segments across fragmented streaming chunks', () => {
    const parser = new StreamingSegmentParser();
    const chunks = [
      '{"segments":[{"type":"narration","text":"alpha","npcId":null,"crewName":null},',
      '{"type":"thought","text":"beta","npcId":null,"crewName":null},',
      '{"type":"dialogue","text":"gamma","npcId":"npc_0","crewName":null}',
      ']}',
    ];

    const out = chunks.flatMap((chunk) => parser.push(chunk));
    expect(out.map((seg) => seg.text)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('[B] preserves escaped quotes and braces in segment text at parsing boundaries', () => {
    const parser = new StreamingSegmentParser();
    const payload =
      '{"segments":[{"type":"narration","text":"status: \\"ok\\" {stable}","npcId":null,"crewName":null}]}';

    const [seg] = parser.push(payload);
    expect(seg.text).toBe('status: "ok" {stable}');
  });

  it('[I] preserves the segment wire contract fields across types', () => {
    const parser = new StreamingSegmentParser();
    const [seg] = parser.push(
      '{"segments":[{"type":"crew_echo","text":"log","npcId":null,"crewName":"Rin"}]}',
    );

    expect(Object.keys(seg).sort()).toEqual([
      'crewName',
      'npcId',
      'text',
      'type',
    ]);
    expect(seg).toEqual({
      type: 'crew_echo',
      text: 'log',
      npcId: null,
      crewName: 'Rin',
    });
  });

  it('[E] ignores malformed segment objects without throwing parser errors', () => {
    const parser = new StreamingSegmentParser();
    const out = parser.push('{"segments":[{"type":"narration","text":oops}]}');

    expect(out).toEqual([]);
  });

  it('[S] resets internal stream state cleanly between standard turn payloads', () => {
    const parser = new StreamingSegmentParser();
    parser.push('{"segments":[{"type":"narration","text":"first","npcId":null,"crewName":null}]}');

    parser.reset();

    const out = parser.push(
      '{"segments":[{"type":"narration","text":"second","npcId":null,"crewName":null}]}',
    );
    expect(out.map((seg) => seg.text)).toEqual(['second']);
  });
});
