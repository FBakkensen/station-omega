import { describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { create, get, getInternal, getStatus, updateAfterTurn } from './games';

type GameDoc = {
  _id: Id<'games'>;
  stationId: Id<'stations'>;
  characterClass: 'engineer' | 'scientist' | 'medic' | 'commander';
  difficulty: 'normal' | 'hard' | 'nightmare';
  state: Record<string, unknown>;
  npcOverrides: Record<string, unknown>;
  roomOverrides: Record<string, unknown>;
  objectivesOverride?: Record<string, unknown>;
  roomDrops: Record<string, unknown>;
  isOver: boolean;
  won: boolean;
  turnCount: number;
  lastTurnAt: number;
};

type StationDoc = {
  _id: Id<'stations'>;
  stationName: string;
};

type GamesCtx = {
  db: {
    get: (id: Id<'games'> | Id<'stations'>) => Promise<GameDoc | StationDoc | null>;
    insert: (table: 'games', doc: Omit<GameDoc, '_id'>) => Promise<Id<'games'>>;
    patch: (id: Id<'games'>, updates: Partial<GameDoc>) => Promise<void>;
  };
};

const getHandler = (
  get as unknown as {
    _handler: (ctx: GamesCtx, args: { id: Id<'games'> }) => Promise<GameDoc | null>;
  }
)._handler;

const createHandler = (
  create as unknown as {
    _handler: (
      ctx: GamesCtx,
      args: {
        stationId: Id<'stations'>;
        characterClass: GameDoc['characterClass'];
        difficulty: GameDoc['difficulty'];
        state: Record<string, unknown>;
      },
    ) => Promise<Id<'games'>>;
  }
)._handler;

const updateAfterTurnHandler = (
  updateAfterTurn as unknown as {
    _handler: (
      ctx: GamesCtx,
      args: {
        gameId: Id<'games'>;
        state: Record<string, unknown>;
        npcOverrides: Record<string, unknown>;
        roomOverrides: Record<string, unknown>;
        objectivesOverride?: Record<string, unknown>;
        roomDrops?: Record<string, unknown>;
        isOver: boolean;
        won: boolean;
        turnCount: number;
      },
    ) => Promise<null>;
  }
)._handler;

const getInternalHandler = (
  getInternal as unknown as {
    _handler: (ctx: GamesCtx, args: { id: Id<'games'> }) => Promise<GameDoc | null>;
  }
)._handler;

const getStatusHandler = (
  getStatus as unknown as {
    _handler: (
      ctx: GamesCtx,
      args: { gameId: Id<'games'> },
    ) => Promise<{
      state: Record<string, unknown>;
      stationName: string;
      characterClass: GameDoc['characterClass'];
      difficulty: GameDoc['difficulty'];
      isOver: boolean;
      won: boolean;
      turnCount: number;
    } | null>;
  }
)._handler;

function createHarness(options?: {
  games?: Record<string, GameDoc>;
  stations?: Record<string, StationDoc>;
}) {
  const games = new Map<string, GameDoc>(Object.entries(options?.games ?? {}));
  const stations = new Map<string, StationDoc>(Object.entries(options?.stations ?? {}));
  const insertedDocs: Array<Omit<GameDoc, '_id'>> = [];
  const patched: Array<{ id: Id<'games'>; updates: Partial<GameDoc> }> = [];

  const db: GamesCtx['db'] = {
    get: vi.fn((id: Id<'games'> | Id<'stations'>) => {
      if (games.has(id)) return Promise.resolve(games.get(id) ?? null);
      if (stations.has(id)) return Promise.resolve(stations.get(id) ?? null);
      return Promise.resolve(null);
    }),
    insert: vi.fn((_table: 'games', doc: Omit<GameDoc, '_id'>) => {
      insertedDocs.push(doc);
      const id = `game_${String(insertedDocs.length)}` as Id<'games'>;
      games.set(id, { _id: id, ...doc });
      return Promise.resolve(id);
    }),
    patch: vi.fn((id: Id<'games'>, updates: Partial<GameDoc>) => {
      patched.push({ id, updates });
      const prior = games.get(id);
      if (prior) {
        games.set(id, { ...prior, ...updates });
      }
      return Promise.resolve();
    }),
  };

  return {
    ctx: { db },
    insertedDocs,
    patched,
    games,
  };
}

describe('games lifecycle contracts', () => {
  it('[Z] returns null status for zero existing games in reactive status query', async () => {
    const { ctx } = createHarness();

    await expect(getStatusHandler(ctx, { gameId: 'missing_game' as Id<'games'> })).resolves.toBeNull();
  });

  it('[O] creates one game document with expected default fields and one insert call', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12_345);
    const { ctx, insertedDocs } = createHarness();

    const createdId = await createHandler(ctx, {
      stationId: 'station_1' as Id<'stations'>,
      characterClass: 'engineer',
      difficulty: 'normal',
      state: { hp: 100 },
    });

    expect(createdId).toBe('game_1');
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]).toMatchObject({
      stationId: 'station_1',
      characterClass: 'engineer',
      difficulty: 'normal',
      npcOverrides: {},
      roomOverrides: {},
      roomDrops: {},
      isOver: false,
      won: false,
      turnCount: 0,
      lastTurnAt: 12_345,
    });

    nowSpy.mockRestore();
  });

  it('[M] patches many turn update fields and refreshes the lifecycle timestamp on updateAfterTurn', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(99_000);
    const gameId = 'game_existing' as Id<'games'>;
    const { ctx, patched } = createHarness({
      games: {
        [gameId]: {
          _id: gameId,
          stationId: 'station_2' as Id<'stations'>,
          characterClass: 'medic',
          difficulty: 'hard',
          state: { hp: 90 },
          npcOverrides: {},
          roomOverrides: {},
          roomDrops: {},
          isOver: false,
          won: false,
          turnCount: 1,
          lastTurnAt: 11_000,
        },
      },
    });

    await expect(
      updateAfterTurnHandler(ctx, {
        gameId,
        state: { hp: 76, oxygen: 55 },
        npcOverrides: { npc_0: { disposition: 'friendly' } },
        roomOverrides: { room_1: { collapsed: true } },
        objectivesOverride: { currentStepIndex: 2 },
        roomDrops: { room_1: ['item_wire'] },
        isOver: true,
        won: false,
        turnCount: 6,
      }),
    ).resolves.toBeNull();

    expect(patched).toHaveLength(1);
    expect(patched[0]).toEqual({
      id: gameId,
      updates: {
        state: { hp: 76, oxygen: 55 },
        npcOverrides: { npc_0: { disposition: 'friendly' } },
        roomOverrides: { room_1: { collapsed: true } },
        objectivesOverride: { currentStepIndex: 2 },
        roomDrops: { room_1: ['item_wire'] },
        isOver: true,
        won: false,
        turnCount: 6,
        lastTurnAt: 99_000,
      },
    });

    nowSpy.mockRestore();
  });

  it('[B] preserves boundary turn-count behavior at zero and high values without contract drift', async () => {
    const gameId = 'game_boundary' as Id<'games'>;
    const { ctx, patched } = createHarness({
      games: {
        [gameId]: {
          _id: gameId,
          stationId: 'station_boundary' as Id<'stations'>,
          characterClass: 'scientist',
          difficulty: 'nightmare',
          state: {},
          npcOverrides: {},
          roomOverrides: {},
          roomDrops: {},
          isOver: false,
          won: false,
          turnCount: 0,
          lastTurnAt: 10,
        },
      },
    });

    await updateAfterTurnHandler(ctx, {
      gameId,
      state: {},
      npcOverrides: {},
      roomOverrides: {},
      isOver: false,
      won: false,
      turnCount: 999,
    });

    expect(patched[0]?.updates.turnCount).toBe(999);
  });

  it('[I] returns status interface fields used by the sidebar when game and station documents exist', async () => {
    const gameId = 'game_status' as Id<'games'>;
    const stationId = 'station_status' as Id<'stations'>;
    const { ctx } = createHarness({
      games: {
        [gameId]: {
          _id: gameId,
          stationId,
          characterClass: 'commander',
          difficulty: 'hard',
          state: { hp: 88, currentRoom: 'room_2' },
          npcOverrides: {},
          roomOverrides: {},
          roomDrops: {},
          isOver: true,
          won: false,
          turnCount: 13,
          lastTurnAt: 20_000,
        },
      },
      stations: {
        [stationId]: {
          _id: stationId,
          stationName: 'Kestrel Array',
        },
      },
    });

    const status = await getStatusHandler(ctx, { gameId });

    expect(status).toEqual({
      state: { hp: 88, currentRoom: 'room_2' },
      stationName: 'Kestrel Array',
      characterClass: 'commander',
      difficulty: 'hard',
      isOver: true,
      won: false,
      turnCount: 13,
    });
  });

  it('[E] returns null status for error-adjacent missing station references', async () => {
    const gameId = 'game_missing_station' as Id<'games'>;
    const { ctx } = createHarness({
      games: {
        [gameId]: {
          _id: gameId,
          stationId: 'station_absent' as Id<'stations'>,
          characterClass: 'engineer',
          difficulty: 'normal',
          state: {},
          npcOverrides: {},
          roomOverrides: {},
          roomDrops: {},
          isOver: false,
          won: false,
          turnCount: 1,
          lastTurnAt: 0,
        },
      },
    });

    await expect(getStatusHandler(ctx, { gameId })).resolves.toBeNull();
  });

  it('[S] follows standard get and internal get flows for normal persisted games', async () => {
    const gameId = 'game_standard' as Id<'games'>;
    const gameDoc: GameDoc = {
      _id: gameId,
      stationId: 'station_standard' as Id<'stations'>,
      characterClass: 'medic',
      difficulty: 'normal',
      state: { hp: 95 },
      npcOverrides: {},
      roomOverrides: {},
      roomDrops: {},
      isOver: false,
      won: false,
      turnCount: 2,
      lastTurnAt: 1_500,
    };
    const { ctx } = createHarness({
      games: { [gameId]: gameDoc },
    });

    await expect(getHandler(ctx, { id: gameId })).resolves.toEqual(gameDoc);
    await expect(getInternalHandler(ctx, { id: gameId })).resolves.toEqual(gameDoc);
  });
});
