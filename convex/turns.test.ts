import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { isProcessing, start } from "./turns";

type GameDoc = {
  isOver: boolean;
  turnCount: number;
};

type LockDoc = {
  _id: string;
  gameId: Id<"games">;
  lockedAt: number;
};

type StartArgs = {
  gameId: Id<"games">;
  playerInput: string;
  modelId?: string;
};

type IsProcessingArgs = {
  gameId: Id<"games">;
};

type StartResult =
  | { ok: true; turnNumber: number }
  | { ok: false; error: string };

type ScheduledCall = {
  delayMs: number;
  fnRef: unknown;
  payload: unknown;
};

type HarnessState = {
  game: GameDoc | null;
  lock: LockDoc | null;
  insertedLocks: Array<{ gameId: Id<"games">; lockedAt: number }>;
  insertedSegments: Array<Record<string, unknown>>;
  deletedLockIds: string[];
  scheduled: ScheduledCall[];
};

type QueryBuilder = {
  eq: (field: string, value: unknown) => QueryBuilder;
};

type TurnsCtx = {
  db: {
    get: (id: Id<"games">) => Promise<GameDoc | null>;
    query: (table: string) => {
      withIndex: (
        index: string,
        callback: (query: QueryBuilder) => unknown,
      ) => { first: () => Promise<LockDoc | null> };
    };
    insert: (table: string, document: Record<string, unknown>) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
  scheduler: {
    runAfter: (delayMs: number, fnRef: unknown, payload: unknown) => Promise<void>;
  };
};

const startHandler = (
  start as unknown as {
    _handler: (ctx: TurnsCtx, args: StartArgs) => Promise<StartResult>;
  }
)._handler;

const isProcessingHandler = (
  isProcessing as unknown as {
    _handler: (ctx: TurnsCtx, args: IsProcessingArgs) => Promise<boolean>;
  }
)._handler;

function makeArgs(overrides?: Partial<StartArgs>): StartArgs {
  return {
    gameId: "game-1" as Id<"games">,
    playerInput: "scan relay",
    ...overrides,
  };
}

function createQueryBuilder(): QueryBuilder {
  return {
    eq: (_field: string, _value: unknown) => createQueryBuilder(),
  };
}

function createTurnsHarness(options?: {
  game?: GameDoc | null;
  lock?: LockDoc | null;
}) {
  const game =
    options && "game" in options ? (options.game ?? null) : { isOver: false, turnCount: 0 };
  const lock = options && "lock" in options ? (options.lock ?? null) : null;

  const state: HarnessState = {
    game,
    lock,
    insertedLocks: [],
    insertedSegments: [],
    deletedLockIds: [],
    scheduled: [],
  };

  const db: TurnsCtx["db"] = {
    get: vi.fn((_id: Id<"games">) => Promise.resolve(state.game)),
    query: vi.fn((_table: string) => ({
      withIndex: vi.fn((_index: string, callback: (query: QueryBuilder) => unknown) => {
        callback(createQueryBuilder());
        return {
          first: vi.fn(() => Promise.resolve(state.lock)),
        };
      }),
    })),
    insert: vi.fn((table: string, document: Record<string, unknown>) => {
      if (table === "turnLocks") {
        const lockDocument = document as { gameId: Id<"games">; lockedAt: number };
        state.insertedLocks.push(lockDocument);
        state.lock = {
          _id: `lock-${String(state.insertedLocks.length)}`,
          gameId: lockDocument.gameId,
          lockedAt: lockDocument.lockedAt,
        };
      }
      if (table === "turnSegments") {
        state.insertedSegments.push(document);
      }
      return Promise.resolve(`insert-${table}`);
    }),
    delete: vi.fn((id: string) => {
      state.deletedLockIds.push(id);
      if (state.lock?._id === id) {
        state.lock = null;
      }
      return Promise.resolve();
    }),
  };

  const scheduler: TurnsCtx["scheduler"] = {
    runAfter: vi.fn((delayMs: number, fnRef: unknown, payload: unknown) => {
      state.scheduled.push({ delayMs, fnRef, payload });
      return Promise.resolve();
    }),
  };

  const ctx: TurnsCtx = { db, scheduler };
  return { ctx, state };
}

describe("turn lifecycle safety behavior", () => {
  it("[Z] reports no processing when lock state is absent", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { ctx } = createTurnsHarness({ lock: null });

    await expect(isProcessingHandler(ctx, { gameId: "game-1" as Id<"games"> })).resolves.toBe(
      false,
    );

    nowSpy.mockRestore();
  });

  it("[O] starts one minimal valid first turn and schedules processing without player action segment", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs());

    expect(result).toEqual({ ok: true, turnNumber: 1 });
    expect(state.insertedLocks).toHaveLength(1);
    expect(state.insertedSegments).toHaveLength(0);
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.delayMs).toBe(0);
    expect(state.scheduled[0]?.payload).toMatchObject({
      gameId: "game-1",
      playerInput: "scan relay",
      turnNumber: 1,
    });

    nowSpy.mockRestore();
  });

  it("[M] auto-expires stale locks and supports multi-turn progression with player action persistence", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(120_000);
    const staleLock: LockDoc = {
      _id: "lock-old",
      gameId: "game-1" as Id<"games">,
      lockedAt: 50_000,
    };
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 4 },
      lock: staleLock,
    });

    const result = await startHandler(ctx, makeArgs({ playerInput: "repair coolant" }));

    expect(result).toEqual({ ok: true, turnNumber: 5 });
    expect(state.deletedLockIds).toEqual(["lock-old"]);
    expect(state.insertedLocks).toHaveLength(1);
    expect(state.insertedSegments).toMatchObject([
      {
        gameId: "game-1",
        turnNumber: 5,
        segmentIndex: 0,
        segment: {
          type: "player_action",
          text: "repair coolant",
          npcId: null,
          crewName: null,
        },
      },
    ]);

    nowSpy.mockRestore();
  });

  it("[B] keeps boundary lock behavior stable at exactly 60000ms by rejecting concurrent turns", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(110_000);
    const boundaryLock: LockDoc = {
      _id: "lock-boundary",
      gameId: "game-1" as Id<"games">,
      lockedAt: 50_000,
    };
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 2 },
      lock: boundaryLock,
    });

    const result = await startHandler(ctx, makeArgs());

    expect(result).toEqual({ ok: false, error: "Turn in progress" });
    expect(state.deletedLockIds).toHaveLength(0);
    expect(state.insertedLocks).toHaveLength(0);
    expect(state.scheduled).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("[I] preserves start response contract fields for both success and failure interfaces", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(300_000);
    const successHarness = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });
    const failureHarness = createTurnsHarness({
      game: { isOver: true, turnCount: 9 },
      lock: null,
    });

    const success = await startHandler(successHarness.ctx, makeArgs());
    const failure = await startHandler(failureHarness.ctx, makeArgs());

    expect(success).toMatchObject({ ok: true, turnNumber: 1 });
    expect(Object.keys(success).sort()).toEqual(["ok", "turnNumber"]);
    expect(failure).toEqual({ ok: false, error: "Game is over" });
    expect(Object.keys(failure).sort()).toEqual(["error", "ok"]);

    nowSpy.mockRestore();
  });

  it("[E] returns explicit errors for invalid start states like missing game records", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(400_000);
    const missingHarness = createTurnsHarness({ game: null, lock: null });
    const completeHarness = createTurnsHarness({
      game: { isOver: true, turnCount: 3 },
      lock: null,
    });

    await expect(startHandler(missingHarness.ctx, makeArgs())).resolves.toEqual({
      ok: false,
      error: "Game not found",
    });
    await expect(startHandler(completeHarness.ctx, makeArgs())).resolves.toEqual({
      ok: false,
      error: "Game is over",
    });

    nowSpy.mockRestore();
  });

  it("[S] returns standard active-processing truthiness and turns false after stale timeout", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(500_000);
    const activeHarness = createTurnsHarness({
      lock: {
        _id: "lock-active",
        gameId: "game-1" as Id<"games">,
        lockedAt: 490_500,
      },
    });
    const staleHarness = createTurnsHarness({
      lock: {
        _id: "lock-stale",
        gameId: "game-1" as Id<"games">,
        lockedAt: 430_000,
      },
    });

    await expect(
      isProcessingHandler(activeHarness.ctx, { gameId: "game-1" as Id<"games"> }),
    ).resolves.toBe(true);
    await expect(
      isProcessingHandler(staleHarness.ctx, { gameId: "game-1" as Id<"games"> }),
    ).resolves.toBe(false);

    nowSpy.mockRestore();
  });
});

describe("modelId allowlist validation", () => {
  it("[Z] omits modelId from scheduled payload when none is provided", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs());

    expect(result).toEqual({ ok: true, turnNumber: 1 });
    const payload = state.scheduled[0]?.payload as Record<string, unknown>;
    expect(payload.modelId).toBeUndefined();

    nowSpy.mockRestore();
  });

  it("[O] forwards a single valid modelId to the scheduled action", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs({ modelId: "google/gemini-3-flash-preview" }));

    expect(result).toEqual({ ok: true, turnNumber: 1 });
    const payload = state.scheduled[0]?.payload as Record<string, unknown>;
    expect(payload.modelId).toBe("google/gemini-3-flash-preview");

    nowSpy.mockRestore();
  });

  it("[M] rejects each invalid modelId independently across multiple calls", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const harness1 = createTurnsHarness({ game: { isOver: false, turnCount: 0 }, lock: null });
    const harness2 = createTurnsHarness({ game: { isOver: false, turnCount: 1 }, lock: null });

    const r1 = await startHandler(harness1.ctx, makeArgs({ modelId: "evil/expensive-model" }));
    const r2 = await startHandler(harness2.ctx, makeArgs({ modelId: "another/bad-model" }));

    expect(r1).toEqual({ ok: false, error: "Invalid model" });
    expect(r2).toEqual({ ok: false, error: "Invalid model" });
    expect(harness1.state.scheduled).toHaveLength(0);
    expect(harness2.state.scheduled).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("[B] rejects a modelId that is a substring of a valid ID", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs({ modelId: "google/gemini-3-flash" }));

    expect(result).toEqual({ ok: false, error: "Invalid model" });
    expect(state.scheduled).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("[I] preserves the ok/error response contract when model is invalid", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs({ modelId: "invalid" }));

    expect(result).toHaveProperty("ok", false);
    expect(result).toHaveProperty("error");
    expect(Object.keys(result).sort()).toEqual(["error", "ok"]);

    nowSpy.mockRestore();
  });

  it("[E] rejects an empty string modelId", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
    const { ctx, state } = createTurnsHarness({
      game: { isOver: false, turnCount: 0 },
      lock: null,
    });

    const result = await startHandler(ctx, makeArgs({ modelId: "" }));

    expect(result).toEqual({ ok: false, error: "Invalid model" });
    expect(state.scheduled).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("[S] accepts each allowlisted model ID in standard flow", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);

    for (const validId of ["google/gemini-3-flash-preview"]) {
      const { ctx, state } = createTurnsHarness({
        game: { isOver: false, turnCount: 0 },
        lock: null,
      });

      const result = await startHandler(ctx, makeArgs({ modelId: validId }));

      expect(result).toEqual({ ok: true, turnNumber: 1 });
      const payload = state.scheduled[0]?.payload as Record<string, unknown>;
      expect(payload.modelId).toBe(validId);
    }

    nowSpy.mockRestore();
  });
});
