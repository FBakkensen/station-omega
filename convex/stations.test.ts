import { describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { get, getInternal, list, remove, save } from './stations';

type Difficulty = 'normal' | 'hard' | 'nightmare';

type StationDoc = {
  _id: Id<'stations'>;
  _creationTime: number;
  stationName: string;
  briefing: string;
  difficulty: Difficulty;
  data?: Record<string, unknown>;
};

type GameDoc = {
  _id: Id<'games'>;
  stationId: Id<'stations'>;
};

type GameChildDoc = {
  _id: string;
  gameId: Id<'games'>;
};

type GameImageDoc = GameChildDoc & {
  stationId: Id<'stations'>;
  storageId: Id<'_storage'>;
};

type StationLogDoc = {
  _id: string;
  stationId: Id<'stations'>;
  gameId?: Id<'games'>;
};

type RunHistoryDoc = {
  _id: string;
  gameId?: Id<'games'>;
};

type StationsCtx = {
  db: {
    query: (table: string) => {
      order: (direction: 'desc') => { collect: () => Promise<StationDoc[]> };
      withIndex: (
        index: string,
        callback: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        collect: () => Promise<Array<StationDoc | GameDoc | GameChildDoc | GameImageDoc | StationLogDoc>>;
      };
      collect?: () => Promise<RunHistoryDoc[]>;
    };
    get: (id: Id<'stations'>) => Promise<StationDoc | null>;
    insert: (
      table: 'stations',
      doc: { stationName: string; briefing: string; difficulty: Difficulty; data: unknown },
    ) => Promise<Id<'stations'>>;
    delete: (id: string) => Promise<void>;
  };
  storage: {
    delete: (id: Id<'_storage'>) => Promise<void>;
  };
};

const listHandler = (
  list as unknown as {
    _handler: (
      ctx: StationsCtx,
      args: Record<string, never>,
    ) => Promise<
      Array<{
        _id: Id<'stations'>;
        _creationTime: number;
        stationName: string;
        briefing: string;
        difficulty: Difficulty;
      }>
    >;
  }
)._handler;

const getHandler = (
  get as unknown as {
    _handler: (ctx: StationsCtx, args: { id: Id<'stations'> }) => Promise<StationDoc | null>;
  }
)._handler;

const getInternalHandler = (
  getInternal as unknown as {
    _handler: (ctx: StationsCtx, args: { id: Id<'stations'> }) => Promise<StationDoc | null>;
  }
)._handler;

const saveHandler = (
  save as unknown as {
    _handler: (
      ctx: StationsCtx,
      args: { stationName: string; briefing: string; difficulty: Difficulty; data: Record<string, unknown> },
    ) => Promise<Id<'stations'>>;
  }
)._handler;

const removeHandler = (
  remove as unknown as {
    _handler: (ctx: StationsCtx, args: { id: Id<'stations'> }) => Promise<null>;
  }
)._handler;

function createStationsHarness(options?: {
  stations?: StationDoc[];
  games?: GameDoc[];
  messages?: GameChildDoc[];
  segments?: GameChildDoc[];
  choices?: GameChildDoc[];
  turnLocks?: GameChildDoc[];
  aiLogs?: StationLogDoc[];
  stationImages?: GameImageDoc[];
  runHistory?: RunHistoryDoc[];
}) {
  const stations = new Map<string, StationDoc>((options?.stations ?? []).map((doc) => [doc._id, doc]));
  const games = [...(options?.games ?? [])];
  const messages = [...(options?.messages ?? [])];
  const segments = [...(options?.segments ?? [])];
  const choices = [...(options?.choices ?? [])];
  const turnLocks = [...(options?.turnLocks ?? [])];
  const aiLogs = [...(options?.aiLogs ?? [])];
  const stationImages = [...(options?.stationImages ?? [])];
  const runHistory = [...(options?.runHistory ?? [])];
  const deletedIds: string[] = [];
  const deletedStorageIds: string[] = [];

  const db: StationsCtx['db'] = {
    query: vi.fn((table: string) => ({
      order: vi.fn((_direction: 'desc') => ({
        collect: vi.fn(() => {
          const docs = [...stations.values()].sort((a, b) => b._creationTime - a._creationTime);
          return Promise.resolve(docs);
        }),
      })),
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
            if (table === 'games') {
              const stationId = conditions.get('stationId') as Id<'stations'> | undefined;
              return Promise.resolve(games.filter((doc) => doc.stationId === stationId));
            }
            if (table === 'messages') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              return Promise.resolve(messages.filter((doc) => doc.gameId === gameId));
            }
            if (table === 'turnSegments') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              return Promise.resolve(segments.filter((doc) => doc.gameId === gameId));
            }
            if (table === 'choiceSets') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              return Promise.resolve(choices.filter((doc) => doc.gameId === gameId));
            }
            if (table === 'turnLocks') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              return Promise.resolve(turnLocks.filter((doc) => doc.gameId === gameId));
            }
            if (table === 'aiLogs') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              const stationId = conditions.get('stationId') as Id<'stations'> | undefined;
              if (gameId) return Promise.resolve(aiLogs.filter((doc) => doc.gameId === gameId));
              if (stationId) return Promise.resolve(aiLogs.filter((doc) => doc.stationId === stationId));
            }
            if (table === 'stationImages') {
              const gameId = conditions.get('gameId') as Id<'games'> | undefined;
              const stationId = conditions.get('stationId') as Id<'stations'> | undefined;
              if (gameId) return Promise.resolve(stationImages.filter((doc) => doc.gameId === gameId));
              if (stationId) return Promise.resolve(stationImages.filter((doc) => doc.stationId === stationId));
            }
            if (table === 'stations') {
              return Promise.resolve([...stations.values()]);
            }
            return Promise.resolve([]);
          }),
        };
      }),
      collect: vi.fn(() => {
        if (table === 'runHistory') {
          return Promise.resolve(runHistory);
        }
        return Promise.resolve([]);
      }),
    })),
    get: vi.fn((id: Id<'stations'>) => Promise.resolve(stations.get(id) ?? null)),
    insert: vi.fn((
      _table: 'stations',
      doc: { stationName: string; briefing: string; difficulty: Difficulty; data: unknown },
    ) => {
      const id = `station_${String(stations.size + 1)}` as Id<'stations'>;
      const data =
        typeof doc.data === 'object' && doc.data !== null
          ? (doc.data as Record<string, unknown>)
          : {};
      stations.set(id, {
        _id: id,
        _creationTime: Date.now(),
        stationName: doc.stationName,
        briefing: doc.briefing,
        difficulty: doc.difficulty,
        data,
      });
      return Promise.resolve(id);
    }),
    delete: vi.fn((id: string) => {
      deletedIds.push(id);
      stations.delete(id);
      const gameIdx = games.findIndex((doc) => doc._id === id);
      if (gameIdx >= 0) games.splice(gameIdx, 1);
      const msgIdx = messages.findIndex((doc) => doc._id === id);
      if (msgIdx >= 0) messages.splice(msgIdx, 1);
      const segIdx = segments.findIndex((doc) => doc._id === id);
      if (segIdx >= 0) segments.splice(segIdx, 1);
      const choiceIdx = choices.findIndex((doc) => doc._id === id);
      if (choiceIdx >= 0) choices.splice(choiceIdx, 1);
      const turnLockIdx = turnLocks.findIndex((doc) => doc._id === id);
      if (turnLockIdx >= 0) turnLocks.splice(turnLockIdx, 1);
      const aiLogIdx = aiLogs.findIndex((doc) => doc._id === id);
      if (aiLogIdx >= 0) aiLogs.splice(aiLogIdx, 1);
      const stationImageIdx = stationImages.findIndex((doc) => doc._id === id);
      if (stationImageIdx >= 0) stationImages.splice(stationImageIdx, 1);
      const runHistoryIdx = runHistory.findIndex((doc) => doc._id === id);
      if (runHistoryIdx >= 0) runHistory.splice(runHistoryIdx, 1);
      return Promise.resolve();
    }),
  };

  const storage: StationsCtx['storage'] = {
    delete: vi.fn((id: Id<'_storage'>) => {
      deletedStorageIds.push(id);
      return Promise.resolve();
    }),
  };

  return {
    ctx: { db, storage },
    deletedIds,
    deletedStorageIds,
    stations,
    games,
    messages,
    segments,
    choices,
    turnLocks,
    aiLogs,
    stationImages,
    runHistory,
  };
}

describe('stations persistence contracts', () => {
  it('[Z] removes a station with zero linked games by deleting only the station record', async () => {
    const stationId = 'station_zero' as Id<'stations'>;
    const { ctx, deletedIds } = createStationsHarness({
      stations: [
        {
          _id: stationId,
          _creationTime: 10,
          stationName: 'Empty Station',
          briefing: 'No linked games',
          difficulty: 'normal',
          data: { heavy: true },
        },
      ],
    });

    await expect(removeHandler(ctx, { id: stationId })).resolves.toBeNull();
    expect(deletedIds).toEqual([stationId]);
  });

  it('[O] saves one station and includes one metadata row in list output', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(555);
    const { ctx } = createStationsHarness();

    const stationId = await saveHandler(ctx, {
      stationName: 'Nova Relay',
      briefing: 'Stabilize the grid',
      difficulty: 'hard',
      data: { rooms: { room_0: { id: 'room_0' } } },
    });
    const rows = await listHandler(ctx, {});

    expect(stationId).toBe('station_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      _id: 'station_1',
      _creationTime: 555,
      stationName: 'Nova Relay',
      briefing: 'Stabilize the grid',
      difficulty: 'hard',
    });

    nowSpy.mockRestore();
  });

  it('[M] removes one station and many linked game artifacts while preserving unrelated rows', async () => {
    const stationTarget = 'station_target' as Id<'stations'>;
    const stationKeep = 'station_keep' as Id<'stations'>;
    const gameA = 'game_a' as Id<'games'>;
    const gameB = 'game_b' as Id<'games'>;
    const gameOther = 'game_other' as Id<'games'>;
    const { ctx, deletedIds, deletedStorageIds } = createStationsHarness({
      stations: [
        {
          _id: stationTarget,
          _creationTime: 100,
          stationName: 'Target Station',
          briefing: 'Delete me',
          difficulty: 'nightmare',
          data: {},
        },
        {
          _id: stationKeep,
          _creationTime: 90,
          stationName: 'Keep Station',
          briefing: 'Remain',
          difficulty: 'normal',
          data: {},
        },
      ],
      games: [
        { _id: gameA, stationId: stationTarget },
        { _id: gameB, stationId: stationTarget },
        { _id: gameOther, stationId: stationKeep },
      ],
      messages: [
        { _id: 'msg_a_1', gameId: gameA },
        { _id: 'msg_b_1', gameId: gameB },
        { _id: 'msg_other', gameId: gameOther },
      ],
      segments: [
        { _id: 'seg_a_1', gameId: gameA },
        { _id: 'seg_b_1', gameId: gameB },
        { _id: 'seg_other', gameId: gameOther },
      ],
      choices: [
        { _id: 'choice_a_1', gameId: gameA },
        { _id: 'choice_b_1', gameId: gameB },
        { _id: 'choice_other', gameId: gameOther },
      ],
      turnLocks: [
        { _id: 'lock_a_1', gameId: gameA },
        { _id: 'lock_b_1', gameId: gameB },
        { _id: 'lock_other', gameId: gameOther },
      ],
      aiLogs: [
        { _id: 'log_a_1', stationId: stationTarget, gameId: gameA },
        { _id: 'log_b_1', stationId: stationTarget, gameId: gameB },
        { _id: 'log_station_only', stationId: stationTarget },
        { _id: 'log_other', stationId: stationKeep, gameId: gameOther },
      ],
      stationImages: [
        { _id: 'img_a_1', gameId: gameA, stationId: stationTarget, storageId: 'blob_a' as Id<'_storage'> },
        { _id: 'img_b_1', gameId: gameB, stationId: stationTarget, storageId: 'blob_b' as Id<'_storage'> },
        { _id: 'img_other', gameId: gameOther, stationId: stationKeep, storageId: 'blob_other' as Id<'_storage'> },
      ],
      runHistory: [
        { _id: 'run_a_1', gameId: gameA },
        { _id: 'run_b_1', gameId: gameB },
        { _id: 'run_other', gameId: gameOther },
      ],
    });

    await removeHandler(ctx, { id: stationTarget });

    expect(deletedStorageIds).toEqual(['blob_a', 'blob_b']);
    expect(deletedIds).toEqual([
      'msg_a_1',
      'seg_a_1',
      'choice_a_1',
      'lock_a_1',
      'log_a_1',
      'img_a_1',
      'run_a_1',
      gameA,
      'msg_b_1',
      'seg_b_1',
      'choice_b_1',
      'lock_b_1',
      'log_b_1',
      'img_b_1',
      'run_b_1',
      gameB,
      'log_station_only',
      stationTarget,
    ]);
    expect(deletedIds).not.toContain('msg_other');
    expect(deletedIds).not.toContain('seg_other');
    expect(deletedIds).not.toContain('choice_other');
    expect(deletedIds).not.toContain('lock_other');
    expect(deletedIds).not.toContain('log_other');
    expect(deletedIds).not.toContain('img_other');
    expect(deletedIds).not.toContain('run_other');
  });

  it('[B] keeps boundary list ordering stable at descending creation-time values', async () => {
    const { ctx } = createStationsHarness({
      stations: [
        {
          _id: 'station_old' as Id<'stations'>,
          _creationTime: 1,
          stationName: 'Old',
          briefing: 'old',
          difficulty: 'normal',
          data: {},
        },
        {
          _id: 'station_new' as Id<'stations'>,
          _creationTime: 9_999,
          stationName: 'New',
          briefing: 'new',
          difficulty: 'hard',
          data: {},
        },
      ],
    });

    const rows = await listHandler(ctx, {});

    expect(rows.map((row) => row._id)).toEqual(['station_new', 'station_old']);
  });

  it('[I] preserves metadata-only list interface fields without leaking heavy data payloads', async () => {
    const stationId = 'station_interface' as Id<'stations'>;
    const { ctx } = createStationsHarness({
      stations: [
        {
          _id: stationId,
          _creationTime: 123,
          stationName: 'Interface Station',
          briefing: 'metadata contract',
          difficulty: 'normal',
          data: { rooms: { huge: 'payload' } },
        },
      ],
    });

    const rows = await listHandler(ctx, {});
    const row = rows[0] as Record<string, unknown>;

    expect(row).toMatchObject({
      _id: stationId,
      _creationTime: 123,
      stationName: 'Interface Station',
      briefing: 'metadata contract',
      difficulty: 'normal',
    });
    expect('data' in row).toBe(false);
  });

  it('[E] handles empty child collections without errors during destructive remove flow', async () => {
    const stationId = 'station_empty_children' as Id<'stations'>;
    const gameId = 'game_no_children' as Id<'games'>;
    const { ctx, deletedIds } = createStationsHarness({
      stations: [
        {
          _id: stationId,
          _creationTime: 42,
          stationName: 'Sparse Station',
          briefing: 'empty collections',
          difficulty: 'hard',
          data: {},
        },
      ],
      games: [{ _id: gameId, stationId }],
      messages: [],
      segments: [],
      choices: [],
    });

    await expect(removeHandler(ctx, { id: stationId })).resolves.toBeNull();
    expect(deletedIds).toEqual([gameId, stationId]);
  });

  it('[S] follows standard get and internal get retrieval for persisted stations', async () => {
    const stationId = 'station_standard' as Id<'stations'>;
    const station: StationDoc = {
      _id: stationId,
      _creationTime: 222,
      stationName: 'Standard Station',
      briefing: 'standard retrieval',
      difficulty: 'normal',
      data: { rooms: { room_0: { id: 'room_0' } } },
    };
    const { ctx } = createStationsHarness({ stations: [station] });

    await expect(getHandler(ctx, { id: stationId })).resolves.toEqual(station);
    await expect(getInternalHandler(ctx, { id: stationId })).resolves.toEqual(station);
  });
});
