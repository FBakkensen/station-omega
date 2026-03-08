"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Generate and cache an AI image for a station.
 * Fire-and-forget — called via ctx.scheduler.runAfter(0, ...) from streamTurn.
 * If the image already exists in the cache, this is a no-op.
 */
export const generate = internalAction({
  args: {
    stationId: v.id("stations"),
    gameId: v.optional(v.id("games")),
    cacheKey: v.string(),
    category: v.union(
      v.literal("room_scene"),
      v.literal("npc_portrait"),
      v.literal("briefing"),
      v.literal("briefing_video"),
    ),
    prompt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { stationId, gameId, cacheKey, category, prompt } = args;
    console.info("[generateImage] Starting", { stationId, cacheKey, category });
    const startMs = Date.now();

    try {
      // Check cache first
      const existing = await ctx.runQuery(internal.stationImages.getByCacheKey, {
        stationId,
        gameId,
        cacheKey,
      });
      if (existing) {
        console.info("[generateImage] Cache hit, skipping generation", { cacheKey });
        try {
          await ctx.runMutation(internal.aiLogs.log, {
            provider: "fal" as const,
            operation: "image_generation" as const,
            stationId,
            gameId,
            prompt,
            status: "cache_hit" as const,
            durationMs: Date.now() - startMs,
            metadata: { cacheKey, category },
          });
        } catch { /* non-fatal */ }
        return null;
      }

      // Check for API key
      const apiKey = process.env.FAL_API_KEY;
      if (!apiKey) {
        console.warn("[generateImage] FAL_API_KEY not configured, skipping");
        return null;
      }

      // Generate image
      const { FalImageClient } = await import("../../src/io/fal-image-client.js");
      const { IMAGE_MODEL_ID } = await import("../../src/model-catalog.js");
      const client = new FalImageClient(apiKey);
      const result = await client.generateImage({
        prompt,
        width: 512,
        height: 512,
      });

      // Store in Convex file storage
      const blob = new Blob([result.imageBytes as BlobPart], { type: result.mimeType });
      const storageId = await ctx.storage.store(blob);

      // Save to cache table
      await ctx.runMutation(internal.stationImages.save, {
        stationId,
        gameId,
        cacheKey,
        storageId,
        prompt,
        category,
      });

      console.info("[generateImage] Image generated and cached", { cacheKey, storageId });

      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "fal" as const,
          operation: "image_generation" as const,
          stationId,
          gameId,
          modelId: IMAGE_MODEL_ID,
          prompt,
          status: "success" as const,
          durationMs: Date.now() - startMs,
          metadata: { cacheKey, category, storageId, width: 512, height: 512 },
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      // Image generation failures are non-fatal — log and move on
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[generateImage] Failed (non-fatal)", { cacheKey, error: message });
      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "fal" as const,
          operation: "image_generation" as const,
          stationId,
          gameId,
          prompt,
          status: "error" as const,
          error: message,
          durationMs: Date.now() - startMs,
          metadata: { cacheKey, category },
        });
      } catch { /* non-fatal */ }
    }

    return null;
  },
});
