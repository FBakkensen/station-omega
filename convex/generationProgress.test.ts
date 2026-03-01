import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import { create, get, remove, update } from './generationProgress';
import type { Difficulty, CharacterClassId } from '../src/types.js';
import type { ProgressStatus } from './generationProgress';
import { extractHandler } from './test_utils';

type GenerationProgressDoc = {
  _id: Id<'generationProgress'>;
  _creationTime: number;
  status: ProgressStatus;
  message: string;
  progress: number;
  config: {
    difficulty: Difficulty;
    characterClass: CharacterClassId;
  };
  error?: string;
  stationId?: Id<'stations'>;
};

type GenerationProgressCtx = {
  db: {
    get: (id: Id<'generationProgress'>) => Promise<GenerationProgressDoc | null>;
    insert: (
      table: 'generationProgress',
      doc: Omit<GenerationProgressDoc, '_id' | '_creationTime'>,
    ) => Promise<Id<'generationProgress'>>;
    patch: (
      id: Id<'generationProgress'>,
      updates: Partial<Omit<GenerationProgressDoc, '_id' | '_creationTime'>>,
    ) => Promise<void>;
    delete: (id: Id<'generationProgress'>) => Promise<void>;
  };
};

const getHandler = extractHandler<GenerationProgressCtx, { id: Id<'generationProgress'> }, GenerationProgressDoc | null>(get);

const createHandler = extractHandler<GenerationProgressCtx, { config: { difficulty: Difficulty; characterClass: CharacterClassId } }, Id<'generationProgress'>>(create);

const updateHandler = extractHandler<GenerationProgressCtx, { id: Id<'generationProgress'>; status: ProgressStatus; message: string; progress: number; error?: string; stationId?: Id<'stations'> }, null>(update);

const removeHandler = extractHandler<GenerationProgressCtx, { id: Id<'generationProgress'> }, null>(remove);

function createHarness(initialDocs?: GenerationProgressDoc[]) {
  const docs = new Map<string, GenerationProgressDoc>(
    (initialDocs ?? []).map((doc) => [doc._id, doc]),
  );
  const inserted: Array<Omit<GenerationProgressDoc, '_id' | '_creationTime'>> = [];
  const patched: Array<{
    id: Id<'generationProgress'>;
    updates: Partial<Omit<GenerationProgressDoc, '_id' | '_creationTime'>>;
  }> = [];
  const deleted: Id<'generationProgress'>[] = [];

  let idCounter = initialDocs?.length ?? 0;

  const db: GenerationProgressCtx['db'] = {
    get: vi.fn((id: Id<'generationProgress'>) => Promise.resolve(docs.get(id) ?? null)),
    insert: vi.fn((
      _table: 'generationProgress',
      doc: Omit<GenerationProgressDoc, '_id' | '_creationTime'>,
    ) => {
      inserted.push(doc);
      idCounter += 1;
      const id = `progress_${String(idCounter)}` as Id<'generationProgress'>;
      docs.set(id, {
        _id: id,
        _creationTime: Date.now(),
        ...doc,
      });
      return Promise.resolve(id);
    }),
    patch: vi.fn((
      id: Id<'generationProgress'>,
      updates: Partial<Omit<GenerationProgressDoc, '_id' | '_creationTime'>>,
    ) => {
      patched.push({ id, updates });
      const existing = docs.get(id);
      if (existing) docs.set(id, { ...existing, ...updates });
      return Promise.resolve();
    }),
    delete: vi.fn((id: Id<'generationProgress'>) => {
      deleted.push(id);
      docs.delete(id);
      return Promise.resolve();
    }),
  };

  return { ctx: { db }, docs, inserted, patched, deleted };
}

describe('generationProgress lifecycle contracts', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[Z] returns null for zero existing progress rows', async () => {
    const { ctx } = createHarness();

    await expect(
      getHandler(ctx, { id: 'progress_missing' as Id<'generationProgress'> }),
    ).resolves.toBeNull();
  });

  it('[O] creates one pending progress tracker with initialization defaults', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(8_888);
    const { ctx, docs, inserted } = createHarness();

    const createdId = await createHandler(ctx, {
      config: { difficulty: 'hard', characterClass: 'medic' },
    });

    expect(createdId).toBe('progress_1');
    expect(inserted).toEqual([
      {
        status: 'pending',
        message: 'Initializing station generation...',
        progress: 0,
        config: { difficulty: 'hard', characterClass: 'medic' },
      },
    ]);
    expect(docs.get(createdId)).toMatchObject({
      _id: createdId,
      _creationTime: 8_888,
      status: 'pending',
      progress: 0,
      message: 'Initializing station generation...',
      config: { difficulty: 'hard', characterClass: 'medic' },
    });

    nowSpy.mockRestore();
  });

  it('[M] applies many sequential stage updates and preserves latest persisted stage', async () => {
    const id = 'progress_1' as Id<'generationProgress'>;
    const { ctx, docs, patched } = createHarness([
      {
        _id: id,
        _creationTime: 1,
        status: 'pending',
        message: 'Initializing station generation...',
        progress: 0,
        config: { difficulty: 'normal', characterClass: 'engineer' },
      },
    ]);

    await updateHandler(ctx, {
      id,
      status: 'topology',
      message: 'Designing station layout...',
      progress: 10,
    });
    await updateHandler(ctx, {
      id,
      status: 'systems',
      message: 'Engineering system failures...',
      progress: 30,
    });
    await updateHandler(ctx, {
      id,
      status: 'creative',
      message: 'Generating creative content...',
      progress: 70,
    });

    expect(patched).toHaveLength(3);
    expect(patched.map((call) => call.updates.status)).toEqual([
      'topology',
      'systems',
      'creative',
    ]);
    expect(docs.get(id)).toMatchObject({
      status: 'creative',
      message: 'Generating creative content...',
      progress: 70,
    });
  });

  it('[B] keeps boundary progress behavior stable at 0 and 100 percent', async () => {
    const id = 'progress_boundary' as Id<'generationProgress'>;
    const { ctx, patched } = createHarness([
      {
        _id: id,
        _creationTime: 2,
        status: 'pending',
        message: 'Initializing',
        progress: 0,
        config: { difficulty: 'nightmare', characterClass: 'commander' },
      },
    ]);

    await updateHandler(ctx, {
      id,
      status: 'pending',
      message: 'Queued',
      progress: 0,
    });
    await updateHandler(ctx, {
      id,
      status: 'complete',
      message: 'Ready',
      progress: 100,
      stationId: 'station_1' as Id<'stations'>,
    });

    expect(patched).toHaveLength(2);
    expect(patched[0]?.updates.progress).toBe(0);
    expect(patched[1]?.updates.progress).toBe(100);
  });

  it('[I] preserves optional error and stationId interface fields on update', async () => {
    const id = 'progress_iface' as Id<'generationProgress'>;
    const { ctx, patched } = createHarness([
      {
        _id: id,
        _creationTime: 3,
        status: 'pending',
        message: 'Initializing',
        progress: 0,
        config: { difficulty: 'normal', characterClass: 'scientist' },
      },
    ]);

    await updateHandler(ctx, {
      id,
      status: 'error',
      message: 'Station generation failed',
      progress: 0,
      error: 'model timeout',
    });
    await updateHandler(ctx, {
      id,
      status: 'complete',
      message: 'Station ready',
      progress: 100,
      stationId: 'station_9' as Id<'stations'>,
    });

    expect(patched[0]).toEqual({
      id,
      updates: {
        status: 'error',
        message: 'Station generation failed',
        progress: 0,
        error: 'model timeout',
      },
    });
    expect(patched[1]).toEqual({
      id,
      updates: {
        status: 'complete',
        message: 'Station ready',
        progress: 100,
        stationId: 'station_9',
      },
    });
  });

  it('[E] handles missing-document remove calls without throwing errors', async () => {
    const { ctx, deleted } = createHarness();
    const missingId = 'progress_missing' as Id<'generationProgress'>;

    await expect(removeHandler(ctx, { id: missingId })).resolves.toBeNull();
    expect(deleted).toEqual([missingId]);
  });

  it('[S] follows the standard create-update-get-remove lifecycle flow', async () => {
    const { ctx } = createHarness();

    const createdId = await createHandler(ctx, {
      config: { difficulty: 'normal', characterClass: 'engineer' },
    });
    await updateHandler(ctx, {
      id: createdId,
      status: 'assembly',
      message: 'Assembling station data...',
      progress: 90,
    });

    const beforeRemove = await getHandler(ctx, { id: createdId });
    expect(beforeRemove).toMatchObject({
      _id: createdId,
      status: 'assembly',
      progress: 90,
      message: 'Assembling station data...',
    });

    await expect(removeHandler(ctx, { id: createdId })).resolves.toBeNull();
    await expect(getHandler(ctx, { id: createdId })).resolves.toBeNull();
  });
});
