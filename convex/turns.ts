import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { isValidGameMasterModelId } from "../src/model-catalog.js";

/**
 * Start a new turn — validates state, acquires lock, schedules AI processing.
 * Returns the turn number so the client can subscribe to segments.
 */
export const start = mutation({
  args: {
    gameId: v.id("games"),
    playerInput: v.string(),
    modelId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), turnNumber: v.number() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    console.info("[turns.start] Turn submitted", { gameId: args.gameId, input: args.playerInput });
    const game = await ctx.db.get(args.gameId);
    if (!game) { console.error("[turns.start] Game not found"); return { ok: false as const, error: "Game not found" }; }
    if (game.isOver) { console.warn("[turns.start] Game is over"); return { ok: false as const, error: "Game is over" }; }

    // Validate modelId against allowlist
    if (args.modelId !== undefined && !isValidGameMasterModelId(args.modelId)) {
      console.warn("[turns.start] Invalid model ID rejected", { modelId: args.modelId });
      return { ok: false as const, error: "Invalid model" };
    }

    // Check turn lock
    const existingLock = await ctx.db
      .query("turnLocks")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .first();

    if (existingLock) {
      console.warn("[turns.start] Existing lock found", { lockedAt: existingLock.lockedAt, ageMs: Date.now() - existingLock.lockedAt });
      // Auto-expire stale locks (60s)
      if (Date.now() - existingLock.lockedAt > 60_000) {
        console.warn("[turns.start] Lock expired, deleting");
        await ctx.db.delete(existingLock._id);
      } else {
        console.warn("[turns.start] Turn in progress, rejecting");
        return { ok: false as const, error: "Turn in progress" };
      }
    }

    // Acquire lock
    await ctx.db.insert("turnLocks", {
      gameId: args.gameId,
      lockedAt: Date.now(),
    });

    const turnNumber = game.turnCount + 1;
    console.info("[turns.start] Lock acquired", { turnNumber });

    // Insert player action segment at index 0 (skip for auto-first-turn)
    if (turnNumber > 1) {
      await ctx.db.insert("turnSegments", {
        gameId: args.gameId,
        turnNumber,
        segmentIndex: 0,
        segment: {
          type: "player_action",
          text: args.playerInput,
          npcId: null,
          crewName: null,
        },
      });
    }

    // Schedule the AI processing action
    await ctx.scheduler.runAfter(0, internal.actions.streamTurn.processAITurn, {
      gameId: args.gameId,
      playerInput: args.playerInput,
      turnNumber,
      ...(args.modelId ? { modelId: args.modelId } : {}),
    });

    console.debug("[turns.start] processAITurn scheduled");
    return { ok: true as const, turnNumber };
  },
});

/** Check if a turn is currently being processed. */
export const isProcessing = query({
  args: { gameId: v.id("games") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("turnLocks")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .first();

    if (!lock) return false;

    // Auto-expire stale locks
    if (Date.now() - lock.lockedAt > 60_000) return false;

    return true;
  },
});
