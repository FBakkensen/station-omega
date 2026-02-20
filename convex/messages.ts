import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Get all messages for a game, ordered by creation time. */
export const list = query({
  args: { gameId: v.id("games") },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      gameId: v.id("games"),
      role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
  },
});

/** Get all messages for a game (internal, for HTTP actions). */
export const listInternal = internalQuery({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
  },
});

/** Append a message to the conversation history. */
export const append = internalMutation({
  args: {
    gameId: v.id("games"),
    role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      gameId: args.gameId,
      role: args.role,
      content: args.content,
    });
  },
});

/** Append multiple messages at once (for batch operations after turn). */
export const appendBatch = internalMutation({
  args: {
    gameId: v.id("games"),
    messages: v.array(
      v.object({
        role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const msg of args.messages) {
      await ctx.db.insert("messages", {
        gameId: args.gameId,
        role: msg.role,
        content: msg.content,
      });
    }
    return null;
  },
});
