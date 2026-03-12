import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { deleteGameCascade } from "./lib/deleteGameCascade";

/** List all saved stations (metadata only, sorted newest first). */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("stations"),
      _creationTime: v.number(),
      stationName: v.string(),
      briefing: v.string(),
      difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    }),
  ),
  handler: async (ctx) => {
    const stations = await ctx.db.query("stations").order("desc").collect();
    return stations.map((s) => ({
      _id: s._id,
      _creationTime: s._creationTime,
      stationName: s.stationName,
      briefing: s.briefing,
      difficulty: s.difficulty,
    }));
  },
});

/** Get a station by ID (full data). */
export const get = query({
  args: { id: v.id("stations") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Get a station by ID (internal, for HTTP actions). */
export const getInternal = internalQuery({
  args: { id: v.id("stations") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Save a generated station (called from generation action). */
export const save = internalMutation({
  args: {
    stationName: v.string(),
    briefing: v.string(),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    data: v.any(),
  },
  returns: v.id("stations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("stations", {
      stationName: args.stationName,
      briefing: args.briefing,
      difficulty: args.difficulty,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: args.data,
    });
  },
});

/** Delete a station and all associated games. */
export const remove = mutation({
  args: { id: v.id("stations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Delete associated games first
    const games = await ctx.db
      .query("games")
      .withIndex("by_station", (q) => q.eq("stationId", args.id))
      .collect();

    for (const game of games) {
      await deleteGameCascade(ctx, game._id);
    }

    const stationLogs = await ctx.db
      .query("aiLogs")
      .withIndex("by_station", (q) => q.eq("stationId", args.id))
      .collect();
    for (const log of stationLogs) {
      await ctx.db.delete(log._id);
    }

    // Delete cached images
    const images = await ctx.db
      .query("stationImages")
      .withIndex("by_station_cache", (q) => q.eq("stationId", args.id))
      .collect();
    for (const img of images) {
      await ctx.storage.delete(img.storageId);
      await ctx.db.delete(img._id);
    }

    await ctx.db.delete(args.id);
    return null;
  },
});
