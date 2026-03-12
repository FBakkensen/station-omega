import { describe, expect, it } from 'vitest';
import {
  collectLegacyGameEntries,
  detectLegacyReasons,
  hasLegacyNpcEntityRefs,
  parseJsonLines,
  type RawGameDoc,
  type RawTurnSegmentDoc,
} from '../scripts/purge-legacy-games.helpers.js';

describe('legacy purge detection helpers', () => {
  it('[Z] returns zero legacy entries when both game and segment inputs are clean', () => {
    const result = collectLegacyGameEntries(
      [{ _id: 'game_clean', state: { metrics: {} } }],
      [{ gameId: 'game_clean', segment: { entityRefs: [{ type: 'room', id: 'room_0' }] } }],
    );

    expect(result).toEqual([]);
  });

  it('[O] detects one game-level legacy marker from the games table', () => {
    const reasons = detectLegacyReasons({ _id: 'game_one', npcOverrides: {} });

    expect(reasons).toEqual(['npcOverrides']);
  });

  it('[M] merges many game and turn-segment signals onto one game id without duplicates', () => {
    const result = collectLegacyGameEntries(
      [
        {
          _id: 'game_many',
          npcOverrides: {},
          state: { npcAllies: [], metrics: { npcInteractions: 2 } },
        },
      ],
      [
        {
          gameId: 'game_many',
          segment: { entityRefs: [{ type: 'npc', id: 'npc_0' }, { type: 'npc', id: 'npc_1' }] },
        },
      ],
    );

    expect(result).toEqual([
      {
        id: 'game_many',
        reasons: [
          'npcOverrides',
          'state.metrics.npcInteractions',
          'state.npcAllies',
          'turnSegments.entityRefs.npc',
        ],
      },
    ]);
  });

  it('[B] matches the exact npc entity-ref boundary and ignores adjacent type values', () => {
    expect(hasLegacyNpcEntityRefs({
      gameId: 'game_boundary',
      segment: { entityRefs: [{ type: 'npc', id: 'npc_0' }] },
    })).toBe(true);

    expect(hasLegacyNpcEntityRefs({
      gameId: 'game_boundary',
      segment: { entityRefs: [{ type: 'npcish', id: 'npc_0' }, { type: 'item', id: 'item_0' }] },
    })).toBe(false);
  });

  it('[I] parses json-lines input and returns a stable merged entry interface', () => {
    const rawGames = '{"_id":"game_b","state":{"npcAllies":[]}}\n\n{"_id":"game_a","npcOverrides":{}}\n';
    const rawSegments = '{"gameId":"game_b","segment":{"entityRefs":[{"type":"npc","id":"npc_9"}]}}\n';

    const result = collectLegacyGameEntries(
      parseJsonLines<RawGameDoc>(rawGames),
      parseJsonLines<RawTurnSegmentDoc>(rawSegments),
    );

    expect(result).toEqual([
      { id: 'game_a', reasons: ['npcOverrides'] },
      { id: 'game_b', reasons: ['state.npcAllies', 'turnSegments.entityRefs.npc'] },
    ]);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(['id', 'reasons']);
  });

  it('[E] tolerates empty or malformed entity-ref payloads without false positives', () => {
    const malformedDocs: RawTurnSegmentDoc[] = [
      { gameId: 'game_err', segment: {} },
      { gameId: 'game_err', segment: { entityRefs: null } },
      { gameId: 'game_err', segment: { entityRefs: ['npc'] } },
      { gameId: 'game_err', segment: { entityRefs: [{ id: 'npc_0' }] } },
    ];

    for (const doc of malformedDocs) {
      expect(hasLegacyNpcEntityRefs(doc)).toBe(false);
    }
  });

  it('[S] detects standard mixed legacy games from both game markers and turn-segment refs', () => {
    const result = collectLegacyGameEntries(
      [
        { _id: 'game_a', state: { metrics: { npcInteractions: 1 } } },
        { _id: 'game_b', state: {} },
      ],
      [
        { gameId: 'game_b', segment: { entityRefs: [{ type: 'npc', id: 'npc_2' }] } },
        { gameId: 'game_clean', segment: { entityRefs: [{ type: 'room', id: 'room_4' }] } },
      ],
    );

    expect(result).toEqual([
      { id: 'game_a', reasons: ['state.metrics.npcInteractions'] },
      { id: 'game_b', reasons: ['turnSegments.entityRefs.npc'] },
    ]);
  });
});