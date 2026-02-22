import { describe, expect, it } from 'vitest';
import { StreamingSegmentParser } from './StreamingSegmentParser';
import { resolveSegment } from './resolveSegment';
import { computeScore, type RunMetrics } from './scoring';

const baseMetrics: RunMetrics = {
  runId: 'run_1',
  characterClass: 'engineer',
  storyArc: 'cascade_failure',
  difficulty: 'normal',
  startTime: 0,
  endTime: null,
  turnCount: 10,
  missionElapsedMinutes: 80,
  moveCount: 4,
  totalDamageTaken: 5,
  totalDamageHealed: 2,
  roomsVisited: ['room_0', 'room_1', 'room_2'],
  itemsUsed: ['item_0'],
  itemsCollected: ['item_0', 'item_1'],
  crewLogsFound: 2,
  creativeActionsAttempted: 1,
  npcInteractions: 1,
  deathCause: null,
  won: true,
  endingId: null,
  systemsDiagnosed: 2,
  systemsRepaired: 2,
  systemsCascaded: 0,
  itemsCrafted: 1,
  improvizedSolutions: 0,
};

describe('web engine deterministic helpers', () => {
  it('[Z] parser returns no segments for empty data', () => {
    const parser = new StreamingSegmentParser();
    expect(parser.push('')).toEqual([]);
  });

  it('[O] resolves narration speaker from arrival callsign', () => {
    const segment = resolveSegment(
      { type: 'narration', text: 'status check', npcId: null, crewName: null },
      0,
      { arrivalScenario: { playerCallsign: 'Vector' } },
    );
    expect(segment.speakerName).toBe('Vector');
  });

  it('[M] parser extracts multiple ordered segments across streamed chunks', () => {
    const parser = new StreamingSegmentParser();
    const chunks = [
      '{"segments":[{"type":"narration","text":"alpha","npcId":null,"crewName":null},',
      '{"type":"dialogue","text":"beta","npcId":"npc_1","crewName":null}',
      ']}',
    ];
    const out = chunks.flatMap((chunk) => parser.push(chunk));
    expect(out.map((s) => s.text)).toEqual(['alpha', 'beta']);
  });

  it('[B] computes high-score boundary grade A with strong metrics', () => {
    const score = computeScore(
      {
        ...baseMetrics,
        systemsDiagnosed: 5,
        systemsRepaired: 5,
        itemsCrafted: 4,
        improvizedSolutions: 4,
      },
      3,
    );
    expect(score.total).toBeGreaterThanOrEqual(375);
    expect(score.grade).toBe('A');
  });

  it('[I] resolves dialogue speaker fallback to npc ID when lookup is missing', () => {
    const segment = resolveSegment(
      { type: 'dialogue', text: '...', npcId: 'npc_unknown', crewName: null },
      1,
      { npcs: {} },
    );
    expect(segment).toMatchObject({
      type: 'dialogue',
      segmentIndex: 1,
      speakerName: 'npc_unknown',
    });
  });

  it('[E] parser ignores malformed JSON objects without crashing', () => {
    const parser = new StreamingSegmentParser();
    expect(parser.push('{"segments":[{"type":"narration","text":oops}]}')).toEqual([]);
  });

  it('[S] computes stable score output for ordinary runs', () => {
    const score = computeScore(baseMetrics, 5);
    expect(score.speed).toBeGreaterThan(0);
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(score.grade);
  });
});
