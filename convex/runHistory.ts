import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List all run history entries, newest first. */
export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db.query("runHistory").order("desc").collect();
  },
});

/** Save a completed run's score. */
export const save = mutation({
  args: {
    gameId: v.optional(v.id("games")),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
    storyArc: v.string(),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    won: v.boolean(),
    endingId: v.union(v.string(), v.null()),
    score: v.object({
      speed: v.number(),
      engineeringEfficiency: v.number(),
      exploration: v.number(),
      resourcefulness: v.number(),
      completion: v.number(),
      total: v.number(),
      grade: v.string(),
    }),
    turnCount: v.number(),
    duration: v.number(),
    date: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("runHistory", args);
    return null;
  },
});
