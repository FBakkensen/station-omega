import { describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { listAllForGame, listByTurn, listLatestTurn, save } from './turnSegments';

type SegmentType =
  | 'narration'
  | 'dialogue'
  | 'thought'
  | 'station_pa'
  | 'crew_echo'
  | 'diagnostic_readout'
  | 'player_action';

type SegmentDoc = {
  _id: Id<'turnSegments'>;
  _creationTime: number;
  gameId: Id<'games'>;
  turnNumber: number;
  segmentIndex: number;
  segment: {
    type: SegmentType;
    text: string;
    npcId: string | null;
    crewName: string | null;
    entityRefs?: Array<{ type: string; id: string }>;
  };
};

type TurnSegmentsCtx = {
  db: {
    get: (id: Id<'games'>) => Promise<{ _id: Id<'games'>; turnCount: number } | null>;
    query: (table: 'turnSegments') => {
      withIndex: (
        index: string,
        callback: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => { collect: () => Promise<SegmentDoc[]> };
    };
    insert: (
      table: 'turnSegments',
      doc: Omit<SegmentDoc, '_id' | '_creationTime'>,
    ) => Promise<Id<'turnSegments'>>;
  };
};

const listByTurnHandler = (
  listByTurn as unknown as {
    _handler: (
      ctx: TurnSegmentsCtx,
      args: { gameId: Id<'games'>; turnNumber: number },
    ) => Promise<SegmentDoc[]>;
  }
)._handler;

const listLatestTurnHandler = (
  listLatestTurn as unknown as {
    _handler: (ctx: TurnSegmentsCtx, args: { gameId: Id<'games'> }) => Promise<SegmentDoc[]>;
  }
)._handler;

const listAllForGameHandler = (
  listAllForGame as unknown as {
    _handler: (ctx: TurnSegmentsCtx, args: { gameId: Id<'games'> }) => Promise<SegmentDoc[]>;
  }
)._handler;

const saveHandler = (
  save as unknown as {
    _handler: (
      ctx: TurnSegmentsCtx,
      args: Omit<SegmentDoc, '_id' | '_creationTime'>,
    ) => Promise<null>;
  }
)._handler;

function createHarness(options?: {
  games?: Array<{ _id: Id<'games'>; turnCount: number }>;
  segments?: SegmentDoc[];
}) {
  const games = new Map<string, { _id: Id<'games'>; turnCount: number }>(
    (options?.games ?? []).map((game) => [game._id, game]),
  );
  const segments = [...(options?.segments ?? [])];
  const insertedDocs: Array<Omit<SegmentDoc, '_id' | '_creationTime'>> = [];

  const db: TurnSegmentsCtx['db'] = {
    get: vi.fn((id: Id<'games'>) => Promise.resolve(games.get(id) ?? null)),
    query: vi.fn((_table: 'turnSegments') => ({
      withIndex: vi.fn((
        _index: string,
        callback: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const conditions = new Map<string, unknown>();
        const query = {
          eq: (field: string, value: unknown) => {
            conditions.set(field, value);
            return query;
          },
        };
        callback(query);
        return {
          collect: vi.fn(() => {
            const gameId = conditions.get('gameId') as Id<'games'> | undefined;
            const turnNumber = conditions.get('turnNumber') as number | undefined;
            const filtered = segments.filter((doc) => {
              if (doc.gameId !== gameId) return false;
              if (typeof turnNumber === 'number') return doc.turnNumber === turnNumber;
              return true;
            });
            return Promise.resolve(filtered);
          }),
        };
      }),
    })),
    insert: vi.fn((_table: 'turnSegments', doc: Omit<SegmentDoc, '_id' | '_creationTime'>) => {
      insertedDocs.push(doc);
      const insertedId = `segment_${String(segments.length + 1)}` as Id<'turnSegments'>;
      segments.push({
        _id: insertedId,
        _creationTime: 0,
        ...doc,
      });
      return Promise.resolve(insertedId);
    }),
  };

  return {
    ctx: { db },
    insertedDocs,
    segments,
  };
}

describe('turnSegments query and persistence contracts', () => {
  it('[Z] returns zero latest-turn segments when the game document is missing', async () => {
    const { ctx } = createHarness();

    await expect(
      listLatestTurnHandler(ctx, { gameId: 'game_missing' as Id<'games'> }),
    ).resolves.toEqual([]);
  });

  it('[O] saves one segment and stores one valid wire-shape payload', async () => {
    const { ctx, insertedDocs } = createHarness();

    const result = await saveHandler(ctx, {
      gameId: 'game_1' as Id<'games'>,
      turnNumber: 1,
      segmentIndex: 0,
      segment: {
        type: 'narration',
        text: 'You enter the relay chamber.',
        npcId: null,
        crewName: null,
      },
    });

    expect(result).toBeNull();
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]).toEqual({
      gameId: 'game_1',
      turnNumber: 1,
      segmentIndex: 0,
      segment: {
        type: 'narration',
        text: 'You enter the relay chamber.',
        npcId: null,
        crewName: null,
      },
    });
  });

  it('[M] lists many game segments across multiple turns while preserving full collection scope', async () => {
    const gameId = 'game_many' as Id<'games'>;
    const { ctx } = createHarness({
      segments: [
        {
          _id: 'segment_1' as Id<'turnSegments'>,
          _creationTime: 1,
          gameId,
          turnNumber: 1,
          segmentIndex: 0,
          segment: { type: 'narration', text: 'alpha', npcId: null, crewName: null },
        },
        {
          _id: 'segment_2' as Id<'turnSegments'>,
          _creationTime: 2,
          gameId,
          turnNumber: 2,
          segmentIndex: 0,
          segment: { type: 'dialogue', text: 'beta', npcId: 'npc_0', crewName: null },
        },
        {
          _id: 'segment_3' as Id<'turnSegments'>,
          _creationTime: 3,
          gameId: 'other_game' as Id<'games'>,
          turnNumber: 1,
          segmentIndex: 0,
          segment: { type: 'thought', text: 'gamma', npcId: null, crewName: null },
        },
      ],
    });

    const rows = await listAllForGameHandler(ctx, { gameId });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.segment.text)).toEqual(['alpha', 'beta']);
  });

  it('[M] strips many legacy npc entity refs from query reads while preserving room and item refs', async () => {
    const gameId = 'game_legacy' as Id<'games'>;
    const expectedRefs = [
      { type: 'room', id: 'room_0' },
      { type: 'item', id: 'item_0' },
    ];
    const { ctx } = createHarness({
      games: [{ _id: gameId, turnCount: 2 }],
      segments: [
        {
          _id: 'segment_legacy' as Id<'turnSegments'>,
          _creationTime: 9,
          gameId,
          turnNumber: 2,
          segmentIndex: 1,
          segment: {
            type: 'narration',
            text: 'Legacy refs',
            npcId: 'npc_0',
            crewName: null,
            entityRefs: [
              { type: 'room', id: 'room_0' },
              { type: 'npc', id: 'npc_0' },
              { type: 'item', id: 'item_0' },
              { type: 'npc', id: 'npc_1' },
            ],
          },
        },
      ],
    });

    const byTurnRows = await listByTurnHandler(ctx, { gameId, turnNumber: 2 });
    const latestRows = await listLatestTurnHandler(ctx, { gameId });
    const allRows = await listAllForGameHandler(ctx, { gameId });

    expect(byTurnRows[0]?.segment.entityRefs).toEqual(expectedRefs);
    expect(latestRows[0]?.segment.entityRefs).toEqual(expectedRefs);
    expect(allRows[0]?.segment.entityRefs).toEqual(expectedRefs);
  });

  it('[B] handles boundary turn-number filtering by returning only the exact turn index', async () => {
    const gameId = 'game_boundary' as Id<'games'>;
    const { ctx } = createHarness({
      segments: [
        {
          _id: 'segment_4' as Id<'turnSegments'>,
          _creationTime: 4,
          gameId,
          turnNumber: 0,
          segmentIndex: 0,
          segment: { type: 'narration', text: 'turn zero', npcId: null, crewName: null },
        },
        {
          _id: 'segment_5' as Id<'turnSegments'>,
          _creationTime: 5,
          gameId,
          turnNumber: 999,
          segmentIndex: 0,
          segment: { type: 'narration', text: 'turn high', npcId: null, crewName: null },
        },
      ],
    });

    const boundaryRows = await listByTurnHandler(ctx, { gameId, turnNumber: 999 });

    expect(boundaryRows).toHaveLength(1);
    expect(boundaryRows[0]?.segment.text).toBe('turn high');
  });

  it('[I] preserves segment interface contract fields in query and persistence outputs', async () => {
    const gameId = 'game_interface' as Id<'games'>;
    const { ctx } = createHarness({
      segments: [
        {
          _id: 'segment_6' as Id<'turnSegments'>,
          _creationTime: 6,
          gameId,
          turnNumber: 3,
          segmentIndex: 2,
          segment: {
            type: 'diagnostic_readout',
            text: 'Power relay mismatch detected.',
            npcId: null,
            crewName: 'Mika Renn',
          },
        },
      ],
    });

    const rows = await listByTurnHandler(ctx, { gameId, turnNumber: 3 });
    const segment = rows[0].segment;

    expect(segment).toEqual({
      type: 'diagnostic_readout',
      text: 'Power relay mismatch detected.',
      npcId: null,
      crewName: 'Mika Renn',
    });
    expect(Object.keys(segment).sort()).toEqual(['crewName', 'npcId', 'text', 'type']);
  });

  it('[E] returns an empty array safely for turn lookups with no matching records', async () => {
    const { ctx } = createHarness({
      segments: [],
    });

    await expect(
      listByTurnHandler(ctx, { gameId: 'game_empty' as Id<'games'>, turnNumber: 12 }),
    ).resolves.toEqual([]);
  });

  it('[S] follows standard latest-turn flow by resolving via game turnCount and returning that slice', async () => {
    const gameId = 'game_standard' as Id<'games'>;
    const { ctx } = createHarness({
      games: [{ _id: gameId, turnCount: 4 }],
      segments: [
        {
          _id: 'segment_7' as Id<'turnSegments'>,
          _creationTime: 7,
          gameId,
          turnNumber: 3,
          segmentIndex: 0,
          segment: { type: 'narration', text: 'turn 3 data', npcId: null, crewName: null },
        },
        {
          _id: 'segment_8' as Id<'turnSegments'>,
          _creationTime: 8,
          gameId,
          turnNumber: 4,
          segmentIndex: 0,
          segment: { type: 'dialogue', text: 'turn 4 data', npcId: 'npc_1', crewName: null },
        },
      ],
    });

    const latest = await listLatestTurnHandler(ctx, { gameId });

    expect(latest).toHaveLength(1);
    expect(latest[0]?.turnNumber).toBe(4);
    expect(latest[0]?.segment.text).toBe('turn 4 data');
  });
});
