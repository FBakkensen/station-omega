import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteGameCascade } from "./deleteGameCascade";

type GameChildDoc = {
  _id: string;
  gameId: Id<"games">;
};

type GameImageDoc = GameChildDoc & {
  storageId: Id<"_storage">;
};

type RunHistoryDoc = {
  _id: string;
  gameId?: Id<"games">;
};

function createDeleteGameHarness(options?: {
  messages?: GameChildDoc[];
  segments?: GameChildDoc[];
  choices?: GameChildDoc[];
  turnLocks?: GameChildDoc[];
  aiLogs?: GameChildDoc[];
  stationImages?: GameImageDoc[];
  runHistory?: RunHistoryDoc[];
}) {
  const messages = [...(options?.messages ?? [])];
  const segments = [...(options?.segments ?? [])];
  const choices = [...(options?.choices ?? [])];
  const turnLocks = [...(options?.turnLocks ?? [])];
  const aiLogs = [...(options?.aiLogs ?? [])];
  const stationImages = [...(options?.stationImages ?? [])];
  const runHistory = [...(options?.runHistory ?? [])];
  const deletedIds: string[] = [];
  const deletedStorageIds: string[] = [];

  const db = {
    query: vi.fn((table: string) => ({
      withIndex: vi.fn((index: string, callback: (query: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
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
            const gameId = conditions.get("gameId") as Id<"games"> | undefined;
            if (table === "messages" && index === "by_game") return Promise.resolve(messages.filter((doc) => doc.gameId === gameId));
            if (table === "turnSegments" && index === "by_game_turn") return Promise.resolve(segments.filter((doc) => doc.gameId === gameId));
            if (table === "choiceSets" && index === "by_game") return Promise.resolve(choices.filter((doc) => doc.gameId === gameId));
            if (table === "turnLocks" && index === "by_game") return Promise.resolve(turnLocks.filter((doc) => doc.gameId === gameId));
            if (table === "aiLogs" && index === "by_game_turn") return Promise.resolve(aiLogs.filter((doc) => doc.gameId === gameId));
            if (table === "stationImages" && index === "by_game_cache") return Promise.resolve(stationImages.filter((doc) => doc.gameId === gameId));
            return Promise.resolve([]);
          }),
        };
      }),
      collect: vi.fn(() => {
        if (table === "runHistory") return Promise.resolve(runHistory);
        return Promise.resolve([]);
      }),
    })),
    delete: vi.fn((id: string) => {
      deletedIds.push(id);
      return Promise.resolve();
    }),
  };

  const storage = {
    delete: vi.fn((id: Id<"_storage">) => {
      deletedStorageIds.push(id);
      return Promise.resolve();
    }),
  };

  return { ctx: { db, storage }, deletedIds, deletedStorageIds };
}

function asCascadeCtx(ctx: ReturnType<typeof createDeleteGameHarness>["ctx"]) {
  return ctx as unknown as Pick<MutationCtx, "db" | "storage">;
}

describe("game cascade deletion", () => {
  it("[Z] deletes zero dependent records before removing one empty game", async () => {
    const gameId = "game_empty" as Id<"games">;
    const { ctx, deletedIds, deletedStorageIds } = createDeleteGameHarness();

    const summary = await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(summary).toEqual({
      messagesDeleted: 0,
      turnSegmentsDeleted: 0,
      choiceSetsDeleted: 0,
      turnLocksDeleted: 0,
      aiLogsDeleted: 0,
      stationImagesDeleted: 0,
      runHistoryDeleted: 0,
      gamesDeleted: 1,
    });
    expect(deletedIds).toEqual([gameId]);
    expect(deletedStorageIds).toEqual([]);
  });

  it("[O] removes one linked document from every dependent table and its storage blob", async () => {
    const gameId = "game_one" as Id<"games">;
    const { ctx, deletedIds, deletedStorageIds } = createDeleteGameHarness({
      messages: [{ _id: "msg_1", gameId }],
      segments: [{ _id: "seg_1", gameId }],
      choices: [{ _id: "choice_1", gameId }],
      turnLocks: [{ _id: "lock_1", gameId }],
      aiLogs: [{ _id: "log_1", gameId }],
      stationImages: [{ _id: "img_1", gameId, storageId: "blob_1" as Id<"_storage"> }],
      runHistory: [{ _id: "run_1", gameId }],
    });

    const summary = await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(summary).toEqual({
      messagesDeleted: 1,
      turnSegmentsDeleted: 1,
      choiceSetsDeleted: 1,
      turnLocksDeleted: 1,
      aiLogsDeleted: 1,
      stationImagesDeleted: 1,
      runHistoryDeleted: 1,
      gamesDeleted: 1,
    });
    expect(deletedStorageIds).toEqual(["blob_1"]);
    expect(deletedIds).toEqual(["msg_1", "seg_1", "choice_1", "lock_1", "log_1", "img_1", "run_1", gameId]);
  });

  it("[M] deletes many mixed linked records for one target game while leaving other game ids untouched", async () => {
    const gameId = "game_many" as Id<"games">;
    const otherGameId = "game_other" as Id<"games">;
    const { ctx, deletedIds, deletedStorageIds } = createDeleteGameHarness({
      messages: [{ _id: "msg_a", gameId }, { _id: "msg_other", gameId: otherGameId }],
      segments: [{ _id: "seg_a", gameId }, { _id: "seg_other", gameId: otherGameId }],
      choices: [{ _id: "choice_a", gameId }, { _id: "choice_other", gameId: otherGameId }],
      turnLocks: [{ _id: "lock_a", gameId }, { _id: "lock_other", gameId: otherGameId }],
      aiLogs: [{ _id: "log_a", gameId }, { _id: "log_other", gameId: otherGameId }],
      stationImages: [
        { _id: "img_a", gameId, storageId: "blob_a" as Id<"_storage"> },
        { _id: "img_other", gameId: otherGameId, storageId: "blob_other" as Id<"_storage"> },
      ],
      runHistory: [{ _id: "run_a", gameId }, { _id: "run_other", gameId: otherGameId }],
    });

    await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(deletedStorageIds).toEqual(["blob_a"]);
    expect(deletedIds).toEqual(["msg_a", "seg_a", "choice_a", "lock_a", "log_a", "img_a", "run_a", gameId]);
    expect(deletedIds).not.toContain("msg_other");
    expect(deletedIds).not.toContain("seg_other");
    expect(deletedIds).not.toContain("choice_other");
    expect(deletedIds).not.toContain("lock_other");
    expect(deletedIds).not.toContain("log_other");
    expect(deletedIds).not.toContain("img_other");
    expect(deletedIds).not.toContain("run_other");
  });

  it("[B] deletes exactly one linked run-history record at the game-id equality boundary", async () => {
    const gameId = "game_boundary" as Id<"games">;
    const { ctx } = createDeleteGameHarness({
      runHistory: [
        { _id: "run_match", gameId },
        { _id: "run_none" },
      ],
    });

    const summary = await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(summary.runHistoryDeleted).toBe(1);
  });

  it("[I] returns the full deletion summary interface with stable numeric fields", async () => {
    const gameId = "game_interface" as Id<"games">;
    const { ctx } = createDeleteGameHarness();

    const summary = await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(typeof summary.messagesDeleted).toBe("number");
    expect(typeof summary.turnSegmentsDeleted).toBe("number");
    expect(typeof summary.choiceSetsDeleted).toBe("number");
    expect(typeof summary.turnLocksDeleted).toBe("number");
    expect(typeof summary.aiLogsDeleted).toBe("number");
    expect(typeof summary.stationImagesDeleted).toBe("number");
    expect(typeof summary.runHistoryDeleted).toBe("number");
    expect(typeof summary.gamesDeleted).toBe("number");
  });

  it("[E] handles empty optional run-history game ids without throwing during cleanup", async () => {
    const gameId = "game_empty_optional" as Id<"games">;
    const { ctx } = createDeleteGameHarness({
      runHistory: [{ _id: "run_none" }],
    });

    await expect(deleteGameCascade(asCascadeCtx(ctx), gameId)).resolves.toMatchObject({
      runHistoryDeleted: 0,
      gamesDeleted: 1,
    });
  });

  it("[S] keeps standard deletion order as children-first then game document", async () => {
    const gameId = "game_standard" as Id<"games">;
    const { ctx, deletedIds } = createDeleteGameHarness({
      messages: [{ _id: "msg_1", gameId }],
      choices: [{ _id: "choice_1", gameId }],
    });

    await deleteGameCascade(asCascadeCtx(ctx), gameId);

    expect(deletedIds[deletedIds.length - 1]).toBe(gameId);
  });
});