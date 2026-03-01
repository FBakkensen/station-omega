import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { append, appendBatch, list, listInternal } from './messages';
import { extractHandler, type QueryBuilder, createQueryBuilder } from './test_utils';

type Role = 'system' | 'user' | 'assistant';

type MessageDoc = {
  _id: Id<'messages'>;
  _creationTime: number;
  gameId: Id<'games'>;
  role: Role;
  content: string;
};

type MessagesCtx = {
  db: {
    query: (table: 'messages') => {
      withIndex: (
        index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => { collect: () => Promise<MessageDoc[]> };
    };
    insert: (
      table: 'messages',
      doc: Omit<MessageDoc, '_id' | '_creationTime'>,
    ) => Promise<Id<'messages'>>;
  };
};

const listHandler = extractHandler<MessagesCtx, { gameId: Id<'games'> }, MessageDoc[]>(list);

const listInternalHandler = extractHandler<MessagesCtx, { gameId: Id<'games'> }, MessageDoc[]>(listInternal);

const appendHandler = extractHandler<MessagesCtx, { gameId: Id<'games'>; role: Role; content: string }, Id<'messages'>>(append);

const appendBatchHandler = extractHandler<MessagesCtx, { gameId: Id<'games'>; messages: Array<{ role: Role; content: string }> }, null>(appendBatch);

function createHarness(initialMessages?: MessageDoc[]) {
  const messages = [...(initialMessages ?? [])];
  const inserted: Array<Omit<MessageDoc, '_id' | '_creationTime'>> = [];
  let idCounter = initialMessages?.length ?? 0;
  let requestedGameId: Id<'games'> | null = null;

  const db: MessagesCtx['db'] = {
    query: vi.fn((_table: 'messages') => ({
      withIndex: vi.fn((
        _index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => {
        requestedGameId = null;
        callback(createQueryBuilder((gameId) => { requestedGameId = gameId; }));

        return {
          collect: vi.fn(() =>
            Promise.resolve(
              messages
                .filter((doc) => requestedGameId !== null && doc.gameId === requestedGameId)
                .sort((a, b) => a._creationTime - b._creationTime),
            ),
          ),
        };
      }),
    })),
    insert: vi.fn((
      _table: 'messages',
      doc: Omit<MessageDoc, '_id' | '_creationTime'>,
    ) => {
      inserted.push(doc);
      idCounter += 1;
      const id = `message_${String(idCounter)}` as Id<'messages'>;
      messages.push({
        _id: id,
        _creationTime: Date.now(),
        ...doc,
      });
      return Promise.resolve(id);
    }),
  };

  return { ctx: { db }, messages, inserted };
}

describe('messages conversation contracts', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[Z] returns zero messages when the game has no conversation history', async () => {
    const { ctx } = createHarness();

    await expect(listHandler(ctx, { gameId: 'game_empty' as Id<'games'> })).resolves.toEqual([]);
  });

  it('[O] appends one message and returns its created id', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_001);
    const { ctx, messages } = createHarness();

    const id = await appendHandler(ctx, {
      gameId: 'game_1' as Id<'games'>,
      role: 'user',
      content: 'scan relay',
    });

    expect(id).toBe('message_1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      _id: 'message_1',
      _creationTime: 1_001,
      gameId: 'game_1',
      role: 'user',
      content: 'scan relay',
    });

    nowSpy.mockRestore();
  });

  it('[M] appends many messages in order and isolates them by game id', async () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(40);
    const gameA = 'game_a' as Id<'games'>;
    const gameB = 'game_b' as Id<'games'>;
    const { ctx } = createHarness();

    await appendBatchHandler(ctx, {
      gameId: gameA,
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'open hatch' },
        { role: 'assistant', content: '{"segments":[]}' },
      ],
    });
    await appendHandler(ctx, { gameId: gameB, role: 'user', content: 'other run' });

    const listed = await listHandler(ctx, { gameId: gameA });
    expect(listed.map((m) => `${m.role}:${m.content}`)).toEqual([
      'system:rules',
      'user:open hatch',
      'assistant:{"segments":[]}',
    ]);

    nowSpy.mockRestore();
  });

  it('[B] accepts boundary empty-string message content without contract drift', async () => {
    const { ctx, inserted } = createHarness();

    const id = await appendHandler(ctx, {
      gameId: 'game_boundary' as Id<'games'>,
      role: 'assistant',
      content: '',
    });

    expect(id).toBe('message_1');
    expect(inserted[0]).toEqual({
      gameId: 'game_boundary',
      role: 'assistant',
      content: '',
    });
  });

  it('[I] returns list rows with stable message interface fields', async () => {
    const { ctx } = createHarness([
      {
        _id: 'message_existing' as Id<'messages'>,
        _creationTime: 5,
        gameId: 'game_iface' as Id<'games'>,
        role: 'system',
        content: 'context',
      },
    ]);

    const rows = await listHandler(ctx, { gameId: 'game_iface' as Id<'games'> });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      '_creationTime',
      '_id',
      'content',
      'gameId',
      'role',
    ]);
  });

  it('[E] handles empty appendBatch input safely without writing rows', async () => {
    const { ctx, inserted } = createHarness();

    await expect(
      appendBatchHandler(ctx, {
        gameId: 'game_empty_batch' as Id<'games'>,
        messages: [],
      }),
    ).resolves.toBeNull();
    expect(inserted).toEqual([]);
  });

  it('[S] mirrors standard list behavior across public and internal queries', async () => {
    const gameId = 'game_standard' as Id<'games'>;
    const { ctx } = createHarness([
      {
        _id: 'message_1' as Id<'messages'>,
        _creationTime: 1,
        gameId,
        role: 'user',
        content: 'diagnose system',
      },
      {
        _id: 'message_2' as Id<'messages'>,
        _creationTime: 2,
        gameId,
        role: 'assistant',
        content: '{"segments":[{"type":"narration","text":"...","npcId":null,"crewName":null}]}',
      },
    ]);

    const publicRows = await listHandler(ctx, { gameId });
    const internalRows = await listInternalHandler(ctx, { gameId });
    expect(internalRows).toEqual(publicRows);
  });
});
