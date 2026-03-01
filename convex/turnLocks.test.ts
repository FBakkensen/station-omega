import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { acquire, isLocked, release } from "./turnLocks";
import { extractHandler, type QueryBuilder, createQueryBuilder } from "./test-utils";

type LockDoc = {
  _id: string;
  gameId: Id<"games">;
  lockedAt: number;
};

type TurnLocksCtx = {
  db: {
    query: (table: string) => {
      withIndex: (
        index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => { first: () => Promise<LockDoc | null> };
    };
    insert: (table: string, document: Record<string, unknown>) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
};

type HarnessState = {
  locksByGame: Map<string, LockDoc>;
  insertedLocks: LockDoc[];
  deletedLockIds: string[];
};

const isLockedHandler = extractHandler<TurnLocksCtx, { gameId: Id<"games"> }, boolean>(isLocked);

const acquireHandler = extractHandler<TurnLocksCtx, { gameId: Id<"games"> }, boolean>(acquire);

const releaseHandler = extractHandler<TurnLocksCtx, { gameId: Id<"games"> }, null>(release);

function createTurnLocksHarness(initialLocks?: LockDoc[]) {
  const locksByGame = new Map<string, LockDoc>();
  for (const lock of initialLocks ?? []) {
    locksByGame.set(lock.gameId, lock);
  }

  let lockCounter = initialLocks?.length ?? 0;
  let requestedGameId: Id<"games"> | null = null;

  const state: HarnessState = {
    locksByGame,
    insertedLocks: [],
    deletedLockIds: [],
  };

  const ctx: TurnLocksCtx = {
    db: {
      query: vi.fn((_table: string) => ({
        withIndex: vi.fn((_index: string, callback: (query: QueryBuilder) => unknown) => {
          requestedGameId = null;
          callback(createQueryBuilder((gameId) => (requestedGameId = gameId)));
          return {
            first: vi.fn(() =>
              Promise.resolve(
                requestedGameId ? state.locksByGame.get(requestedGameId) ?? null : null,
              ),
            ),
          };
        }),
      })),
      insert: vi.fn((table: string, document: Record<string, unknown>) => {
        if (table !== "turnLocks") {
          return Promise.resolve(`insert-${table}`);
        }

        lockCounter += 1;
        const stored: LockDoc = {
          _id: `lock-${String(lockCounter)}`,
          gameId: document.gameId as Id<"games">,
          lockedAt: document.lockedAt as number,
        };
        state.locksByGame.set(stored.gameId, stored);
        state.insertedLocks.push(stored);
        return Promise.resolve(stored._id);
      }),
      delete: vi.fn((id: string) => {
        state.deletedLockIds.push(id);
        for (const [gameId, lock] of state.locksByGame.entries()) {
          if (lock._id === id) {
            state.locksByGame.delete(gameId);
          }
        }
        return Promise.resolve();
      }),
    },
  };

  return { ctx, state };
}

describe("turn lock contract behavior", () => {
  it("[Z] reports unlocked for an empty lock state with no game lock", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { ctx } = createTurnLocksHarness();

    await expect(isLockedHandler(ctx, { gameId: "game-1" as Id<"games"> })).resolves.toBe(
      false,
    );

    nowSpy.mockRestore();
  });

  it("[O] acquires one lock for a single game when starting from unlocked state", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const gameId = "game-1" as Id<"games">;
    const { ctx, state } = createTurnLocksHarness();

    await expect(acquireHandler(ctx, { gameId })).resolves.toBe(true);

    expect(state.insertedLocks).toHaveLength(1);
    expect(state.insertedLocks[0]).toMatchObject({
      gameId,
      lockedAt: 200_000,
    });
    expect(state.locksByGame.get(gameId)).toMatchObject({
      gameId,
      lockedAt: 200_000,
    });

    nowSpy.mockRestore();
  });

  it("[M] handles many games independently when acquiring and releasing locks", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(300_000);
    const gameA = "game-a" as Id<"games">;
    const gameB = "game-b" as Id<"games">;
    const { ctx, state } = createTurnLocksHarness();

    await expect(acquireHandler(ctx, { gameId: gameA })).resolves.toBe(true);
    await expect(acquireHandler(ctx, { gameId: gameB })).resolves.toBe(true);
    await expect(releaseHandler(ctx, { gameId: gameA })).resolves.toBeNull();

    expect(state.locksByGame.has(gameA)).toBe(false);
    expect(state.locksByGame.has(gameB)).toBe(true);
    expect(state.insertedLocks).toHaveLength(2);

    nowSpy.mockRestore();
  });

  it("[B] keeps boundary behavior stable at exactly 60000ms old by treating lock as active", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(110_000);
    const gameId = "game-1" as Id<"games">;
    const { ctx, state } = createTurnLocksHarness([
      {
        _id: "lock-boundary",
        gameId,
        lockedAt: 50_000,
      },
    ]);

    await expect(isLockedHandler(ctx, { gameId })).resolves.toBe(true);
    await expect(acquireHandler(ctx, { gameId })).resolves.toBe(false);
    expect(state.deletedLockIds).toHaveLength(0);
    expect(state.insertedLocks).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("[I] preserves acquire/release return interface contracts and lock document shape", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(210_000);
    const gameId = "game-1" as Id<"games">;
    const { ctx, state } = createTurnLocksHarness();

    const acquired = await acquireHandler(ctx, { gameId });
    const released = await releaseHandler(ctx, { gameId });

    expect(typeof acquired).toBe("boolean");
    expect(acquired).toBe(true);
    expect(released).toBeNull();
    expect(state.insertedLocks).toHaveLength(1);
    const inserted = state.insertedLocks[0];
    expect(typeof inserted._id).toBe("string");
    expect(inserted.gameId).toBe(gameId);
    expect(inserted.lockedAt).toBe(210_000);

    nowSpy.mockRestore();
  });

  it("[E] replaces stale locks after timeout and returns true instead of failing", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_001);
    const gameId = "game-1" as Id<"games">;
    const { ctx, state } = createTurnLocksHarness([
      {
        _id: "lock-stale",
        gameId,
        lockedAt: 140_000,
      },
    ]);

    await expect(acquireHandler(ctx, { gameId })).resolves.toBe(true);

    expect(state.deletedLockIds).toEqual(["lock-stale"]);
    expect(state.insertedLocks).toHaveLength(1);
    expect(state.locksByGame.get(gameId)?.lockedAt).toBe(200_001);

    nowSpy.mockRestore();
  });

  it("[S] follows standard release flow by doing nothing when game has no active lock", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(400_000);
    const { ctx, state } = createTurnLocksHarness();

    await expect(releaseHandler(ctx, { gameId: "game-1" as Id<"games"> })).resolves.toBeNull();

    expect(state.deletedLockIds).toHaveLength(0);
    expect(state.locksByGame.size).toBe(0);

    nowSpy.mockRestore();
  });
});
