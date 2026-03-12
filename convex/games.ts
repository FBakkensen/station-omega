import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Get a game by ID. */
export const get = query({
  args: { id: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Create a new game session. */
export const create = mutation({
  args: {
    stationId: v.id("stations"),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    state: v.any(),
  },
  returns: v.id("games"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("games", {
      stationId: args.stationId,
      characterClass: args.characterClass,
      difficulty: args.difficulty,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      state: args.state,
      roomOverrides: {},
      roomDrops: {},
      isOver: false,
      won: false,
      turnCount: 0,
      lastTurnAt: Date.now(),
    });
  },
});

/** Update game state after a turn completes (called from streamTurn action). */
export const updateAfterTurn = internalMutation({
  args: {
    gameId: v.id("games"),
    state: v.any(),
    roomOverrides: v.any(),
    objectivesOverride: v.optional(v.any()),
    roomDrops: v.optional(v.any()),
    isOver: v.boolean(),
    won: v.boolean(),
    turnCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { gameId, ...updates } = args;
    await ctx.db.patch(gameId, {
      ...updates,
      lastTurnAt: Date.now(),
    });
    return null;
  },
});

/** Get a game by ID (internal, for HTTP actions). */
export const getInternal = internalQuery({
  args: { id: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Get game state for the sidebar (reactive query). */
export const getStatus = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;

    const station = await ctx.db.get(game.stationId);
    if (!station) return null;

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      state: game.state,
      stationName: station.stationName,
      characterClass: game.characterClass,
      difficulty: game.difficulty,
      isOver: game.isOver,
      won: game.won,
      turnCount: game.turnCount,
    };
  },
});
