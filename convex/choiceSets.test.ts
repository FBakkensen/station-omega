import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { getCurrent, save } from './choiceSets';
import { extractHandler, type QueryBuilder, createQueryBuilder } from './test_utils';

type Choice = {
  id: string;
  label: string;
  description: string;
};

type ChoiceSetDoc = {
  _id: Id<'choiceSets'>;
  _creationTime: number;
  gameId: Id<'games'>;
  turnNumber: number;
  choices: Choice[];
};

type ChoiceSetsCtx = {
  db: {
    query: (table: 'choiceSets') => {
      withIndex: (
        index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => {
        order: (direction: 'desc') => { first: () => Promise<ChoiceSetDoc | null> };
      };
    };
    insert: (
      table: 'choiceSets',
      doc: Omit<ChoiceSetDoc, '_id' | '_creationTime'>,
    ) => Promise<Id<'choiceSets'>>;
  };
};

const getCurrentHandler = extractHandler<ChoiceSetsCtx, { gameId: Id<'games'> }, ChoiceSetDoc | null>(getCurrent);

const saveHandler = extractHandler<ChoiceSetsCtx, { gameId: Id<'games'>; turnNumber: number; choices: Choice[] }, null>(save);

function createHarness(initialRows?: ChoiceSetDoc[]) {
  const rows = [...(initialRows ?? [])];
  const inserted: Array<Omit<ChoiceSetDoc, '_id' | '_creationTime'>> = [];
  let idCounter = initialRows?.length ?? 0;
  let requestedGameId: Id<'games'> | null = null;

  const db: ChoiceSetsCtx['db'] = {
    query: vi.fn((_table: 'choiceSets') => ({
      withIndex: vi.fn((
        _index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => {
        requestedGameId = null;
        callback(createQueryBuilder((gameId) => { requestedGameId = gameId; }));

        return {
          order: vi.fn((_direction: 'desc') => ({
            first: vi.fn(() => {
              const candidates = rows
                .filter((doc) => requestedGameId !== null && doc.gameId === requestedGameId)
                .sort((a, b) => b._creationTime - a._creationTime);
              return Promise.resolve(candidates[0] ?? null);
            }),
          })),
        };
      }),
    })),
    insert: vi.fn((
      _table: 'choiceSets',
      doc: Omit<ChoiceSetDoc, '_id' | '_creationTime'>,
    ) => {
      inserted.push(doc);
      idCounter += 1;
      const id = `choice_set_${String(idCounter)}` as Id<'choiceSets'>;
      rows.push({
        _id: id,
        _creationTime: Date.now(),
        ...doc,
      });
      return Promise.resolve(id);
    }),
  };

  return { ctx: { db }, rows, inserted };
}

describe('choiceSets current-choice contracts', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[Z] returns null when zero choice sets exist for a game', async () => {
    const { ctx } = createHarness();

    await expect(
      getCurrentHandler(ctx, { gameId: 'game_empty' as Id<'games'> }),
    ).resolves.toBeNull();
  });

  it('[O] saves one choice set with one turn payload and returns null', async () => {
    const { ctx, inserted } = createHarness();

    await expect(
      saveHandler(ctx, {
        gameId: 'game_1' as Id<'games'>,
        turnNumber: 2,
        choices: [{ id: 'choice_1', label: 'Inspect panel', description: 'Check for arc damage' }],
      }),
    ).resolves.toBeNull();

    expect(inserted).toEqual([
      {
        gameId: 'game_1',
        turnNumber: 2,
        choices: [{ id: 'choice_1', label: 'Inspect panel', description: 'Check for arc damage' }],
      },
    ]);
  });

  it('[M] returns the latest set across many turns while isolating other games', async () => {
    const gameA = 'game_a' as Id<'games'>;
    const gameB = 'game_b' as Id<'games'>;
    const { ctx } = createHarness([
      {
        _id: 'choice_set_1' as Id<'choiceSets'>,
        _creationTime: 100,
        gameId: gameA,
        turnNumber: 1,
        choices: [{ id: 'a1', label: 'A1', description: 'first' }],
      },
      {
        _id: 'choice_set_2' as Id<'choiceSets'>,
        _creationTime: 200,
        gameId: gameB,
        turnNumber: 4,
        choices: [{ id: 'b1', label: 'B1', description: 'other game' }],
      },
      {
        _id: 'choice_set_3' as Id<'choiceSets'>,
        _creationTime: 300,
        gameId: gameA,
        turnNumber: 2,
        choices: [{ id: 'a2', label: 'A2', description: 'latest for game A' }],
      },
    ]);

    const current = await getCurrentHandler(ctx, { gameId: gameA });
    expect(current).toMatchObject({
      _id: 'choice_set_3',
      gameId: gameA,
      turnNumber: 2,
      choices: [{ id: 'a2', label: 'A2', description: 'latest for game A' }],
    });
  });

  it('[B] keeps latest-selection behavior stable at boundary turn numbers', async () => {
    const gameId = 'game_boundary' as Id<'games'>;
    const { ctx } = createHarness([
      {
        _id: 'choice_set_4' as Id<'choiceSets'>,
        _creationTime: 10,
        gameId,
        turnNumber: 0,
        choices: [{ id: 'zero', label: 'Zero', description: 'boundary low turn' }],
      },
      {
        _id: 'choice_set_5' as Id<'choiceSets'>,
        _creationTime: 20,
        gameId,
        turnNumber: 999,
        choices: [{ id: 'high', label: 'High', description: 'boundary high turn' }],
      },
    ]);

    const current = await getCurrentHandler(ctx, { gameId });
    expect(current?.turnNumber).toBe(999);
    expect(current?.choices[0]?.id).toBe('high');
  });

  it('[I] preserves the choice item interface fields in current-set responses', async () => {
    const gameId = 'game_iface' as Id<'games'>;
    const { ctx } = createHarness([
      {
        _id: 'choice_set_6' as Id<'choiceSets'>,
        _creationTime: 111,
        gameId,
        turnNumber: 7,
        choices: [{ id: 'route', label: 'Route power', description: 'Shift power to life support' }],
      },
    ]);

    const current = await getCurrentHandler(ctx, { gameId });
    if (!current) throw new Error('Expected current choice set');
    expect(Object.keys(current.choices[0] ?? {}).sort()).toEqual([
      'description',
      'id',
      'label',
    ]);
  });

  it('[E] handles empty-choice saves safely for error-adjacent no-choice turns', async () => {
    const { ctx, inserted } = createHarness();

    await expect(
      saveHandler(ctx, {
        gameId: 'game_no_choices' as Id<'games'>,
        turnNumber: 3,
        choices: [],
      }),
    ).resolves.toBeNull();

    expect(inserted).toEqual([
      {
        gameId: 'game_no_choices',
        turnNumber: 3,
        choices: [],
      },
    ]);
  });

  it('[S] follows the standard save-then-read flow for current choices', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5_555);
    const gameId = 'game_standard' as Id<'games'>;
    const { ctx } = createHarness();

    await saveHandler(ctx, {
      gameId,
      turnNumber: 1,
      choices: [{ id: 'diag', label: 'Run diagnostics', description: 'Collect system telemetry' }],
    });

    const current = await getCurrentHandler(ctx, { gameId });
    expect(current).toMatchObject({
      _creationTime: 5_555,
      gameId,
      turnNumber: 1,
      choices: [{ id: 'diag', label: 'Run diagnostics', description: 'Collect system telemetry' }],
    });

    nowSpy.mockRestore();
  });
});
