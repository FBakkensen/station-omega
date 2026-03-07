import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export type ProgressStatus =
  | 'pending'
  | 'topology'
  | 'systems'
  | 'objectives'
  | 'creative'
  | 'assembly'
  | 'video'
  | 'complete'
  | 'error';

/** Get generation progress by ID (reactive — UI subscribes to this). */
export const get = query({
  args: { id: v.id("generationProgress") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Create a new generation progress tracker. */
export const create = internalMutation({
  args: {
    config: v.object({
      difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
      characterClass: v.union(
        v.literal("engineer"),
        v.literal("scientist"),
        v.literal("medic"),
        v.literal("commander"),
      ),
    }),
  },
  returns: v.id("generationProgress"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("generationProgress", {
      status: "pending",
      message: "Initializing station generation...",
      progress: 0,
      config: args.config,
    });
  },
});

/** Update generation progress (called from generation action). */
export const update = internalMutation({
  args: {
    id: v.id("generationProgress"),
    status: v.union(
      v.literal("pending"),
      v.literal("topology"),
      v.literal("systems"),
      v.literal("objectives"),
      v.literal("creative"),
      v.literal("assembly"),
      v.literal("video"),
      v.literal("complete"),
      v.literal("error"),
    ),
    message: v.string(),
    progress: v.number(),
    error: v.optional(v.string()),
    stationId: v.optional(v.id("stations")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return null;
  },
});

/** Clean up completed/errored progress docs. */
export const remove = internalMutation({
  args: { id: v.id("generationProgress") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
