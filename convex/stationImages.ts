import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/** Check if an image exists for a given cache key (internal). Uses game-scoped index when gameId is provided. */
export const getByCacheKey = internalQuery({
  args: {
    stationId: v.id("stations"),
    gameId: v.optional(v.id("games")),
    cacheKey: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.gameId) {
      return await ctx.db
        .query("stationImages")
        .withIndex("by_game_cache", (q) =>
          q.eq("gameId", args.gameId).eq("cacheKey", args.cacheKey),
        )
        .first();
    }
    return await ctx.db
      .query("stationImages")
      .withIndex("by_station_cache", (q) =>
        q.eq("stationId", args.stationId).eq("cacheKey", args.cacheKey),
      )
      .first();
  },
});

/** Save a generated image to the cache (internal). */
export const save = internalMutation({
  args: {
    stationId: v.id("stations"),
    gameId: v.optional(v.id("games")),
    cacheKey: v.string(),
    storageId: v.id("_storage"),
    prompt: v.string(),
    category: v.union(
      v.literal("room_scene"),
      v.literal("npc_portrait"),
      v.literal("briefing"),
      v.literal("briefing_video"),
      v.literal("item_image"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("stationImages", {
      stationId: args.stationId,
      gameId: args.gameId,
      cacheKey: args.cacheKey,
      storageId: args.storageId,
      prompt: args.prompt,
      category: args.category,
    });
    return null;
  },
});

async function resolveImageUrls(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  images: Array<{ cacheKey: string; storageId: Id<"_storage">; category: string }>,
) {
  const entries = await Promise.all(
    images.map(async (img) => ({
      cacheKey: img.cacheKey,
      url: await ctx.storage.getUrl(img.storageId),
      category: img.category,
    })),
  );
  return entries;
}

/** Get cached images for a game session (game-scoped + station-scoped briefings). */
export const listForGame = query({
  args: {
    gameId: v.id("games"),
    stationId: v.id("stations"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Game-scoped images (rooms, NPCs)
    const gameImages = await ctx.db
      .query("stationImages")
      .withIndex("by_game_cache", (q) =>
        q.eq("gameId", args.gameId),
      )
      .collect();

    // Station-scoped images (briefings — no gameId)
    const stationImages = await ctx.db
      .query("stationImages")
      .withIndex("by_station_cache", (q) =>
        q.eq("stationId", args.stationId),
      )
      .filter((q) => q.eq(q.field("gameId"), undefined))
      .collect();

    return resolveImageUrls(ctx, [...gameImages, ...stationImages]);
  },
});

/** Get all cached images for a station (public, for client display). */
export const listForStation = query({
  args: { stationId: v.id("stations") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const images = await ctx.db
      .query("stationImages")
      .withIndex("by_station_cache", (q) =>
        q.eq("stationId", args.stationId),
      )
      .collect();

    return resolveImageUrls(ctx, images);
  },
});
