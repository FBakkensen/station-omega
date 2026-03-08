"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Generate and cache an AI briefing video for a station.
 * Fire-and-forget — called via ctx.scheduler.runAfter(0, ...) from generateStation.
 * If the video already exists in the cache, this is a no-op.
 */
export const generate = internalAction({
  args: {
    stationId: v.id("stations"),
    cacheKey: v.string(),
    category: v.literal("briefing_video"),
    prompt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { stationId, cacheKey, category, prompt } = args;
    console.info("[generateVideo] Starting", { stationId, cacheKey, category });
    const startMs = Date.now();

    try {
      // Check cache first
      const existing = await ctx.runQuery(internal.stationImages.getByCacheKey, {
        stationId,
        cacheKey,
      });
      if (existing) {
        console.info("[generateVideo] Cache hit, skipping generation", { cacheKey });
        try {
          await ctx.runMutation(internal.aiLogs.log, {
            provider: "fal" as const,
            operation: "video_generation" as const,
            stationId,
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
        console.warn("[generateVideo] FAL_API_KEY not configured, skipping");
        return null;
      }

      // Generate video
      const { FalVideoClient } = await import("../../src/io/fal-video-client.js");
      const client = new FalVideoClient(apiKey);
      const result = await client.generateVideo({ prompt });

      // Store in Convex file storage
      const blob = new Blob([result.videoBytes as BlobPart], { type: result.mimeType });
      const storageId = await ctx.storage.store(blob);

      // Save to cache table
      await ctx.runMutation(internal.stationImages.save, {
        stationId,
        cacheKey,
        storageId,
        prompt,
        category,
      });

      console.info("[generateVideo] Video generated and cached", { cacheKey, storageId });

      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "fal" as const,
          operation: "video_generation" as const,
          stationId,
          modelId: "veo3.1/fast",
          prompt,
          status: "success" as const,
          durationMs: Date.now() - startMs,
          metadata: { cacheKey, category, storageId },
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      // Video generation failures are non-fatal — log and move on
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[generateVideo] Failed (non-fatal)", { cacheKey, error: message });
      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "fal" as const,
          operation: "video_generation" as const,
          stationId,
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
