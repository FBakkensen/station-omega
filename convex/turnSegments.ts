import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const segmentValidator = v.object({
  type: v.union(
    v.literal("narration"),
    v.literal("dialogue"),
    v.literal("thought"),
    v.literal("station_pa"),
    v.literal("crew_echo"),
    v.literal("diagnostic_readout"),
    v.literal("player_action"),
  ),
  text: v.string(),
  npcId: v.union(v.string(), v.null()),
  crewName: v.union(v.string(), v.null()),
});

/** Get all segments for a specific turn. */
export const listByTurn = query({
  args: { gameId: v.id("games"), turnNumber: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("turnSegments"),
      _creationTime: v.number(),
      gameId: v.id("games"),
      turnNumber: v.number(),
      segmentIndex: v.number(),
      segment: segmentValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("turnSegments")
      .withIndex("by_game_turn", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .collect();
  },
});

/** Get the latest turn's segments for a game. */
export const listLatestTurn = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return [];

    return await ctx.db
      .query("turnSegments")
      .withIndex("by_game_turn", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.turnCount),
      )
      .collect();
  },
});

/** Get all segments for a game across all turns, ordered by turn then index. */
export const listAllForGame = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("turnSegments")
      .withIndex("by_game_turn", (q) => q.eq("gameId", args.gameId))
      .collect();
  },
});

/** Save a segment (called from streamTurn action). */
export const save = internalMutation({
  args: {
    gameId: v.id("games"),
    turnNumber: v.number(),
    segmentIndex: v.number(),
    segment: segmentValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("turnSegments", {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
      segmentIndex: args.segmentIndex,
      segment: args.segment,
    });
    return null;
  },
});
