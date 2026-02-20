import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const LOCK_TIMEOUT_MS = 60_000; // 1 minute

/** Check if a game is currently locked for a turn. */
export const isLocked = internalQuery({
  args: { gameId: v.id("games") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("turnLocks")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .first();

    if (!lock) return false;

    // Auto-expire stale locks
    if (Date.now() - lock.lockedAt > LOCK_TIMEOUT_MS) {
      return false;
    }

    return true;
  },
});

/** Acquire a turn lock. Returns true if acquired, false if already locked. */
export const acquire = internalMutation({
  args: { gameId: v.id("games") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("turnLocks")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .first();

    if (existing) {
      // Check if stale
      if (Date.now() - existing.lockedAt > LOCK_TIMEOUT_MS) {
        await ctx.db.delete(existing._id);
      } else {
        return false;
      }
    }

    await ctx.db.insert("turnLocks", {
      gameId: args.gameId,
      lockedAt: Date.now(),
    });
    return true;
  },
});

/** Release a turn lock. */
export const release = internalMutation({
  args: { gameId: v.id("games") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("turnLocks")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .first();

    if (lock) {
      await ctx.db.delete(lock._id);
    }
    return null;
  },
});
