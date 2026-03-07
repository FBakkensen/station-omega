import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Get the current choice set for a game (latest). */
export const getCurrent = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const choices = await ctx.db
      .query("choiceSets")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .first();
    return choices;
  },
});

/** Save a new choice set (called from streamTurn action). */
export const save = internalMutation({
  args: {
    gameId: v.id("games"),
    turnNumber: v.number(),
    title: v.string(),
    choices: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        description: v.string(),
        risk: v.optional(
          v.union(
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("critical"),
          ),
        ),
        timeCost: v.optional(v.string()),
        consequence: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("choiceSets", {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
      title: args.title,
      choices: args.choices,
    });
    return null;
  },
});
