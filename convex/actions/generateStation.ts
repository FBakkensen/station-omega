"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

/**
 * Station generation action — runs the 4-layer AI pipeline.
 *
 * This runs in the Node.js runtime to access the AI SDK and OpenRouter.
 * It calls back into Convex mutations to update progress and save the station.
 */
export const generate = internalAction({
  args: {
    progressId: v.id("generationProgress"),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
    modelId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { progressId, difficulty, characterClass, modelId } = args;
    console.info("[generateStation] Starting generation", { progressId, difficulty, characterClass, modelId });
    const progressUpdatePromises: Promise<unknown>[] = [];
    const genStartMs = Date.now();
    let effectiveModelId = "unknown";

    try {
      // Dynamic import of the generation pipeline (ESM from src/)
      console.debug("[generateStation] Importing modules...");
      const { generateStation } = await import("../../src/generation/index.js");
      const { OpenRouterAITextClient } = await import("../../src/io/openrouter-ai-client.js");
      const { GENERATION_MODEL_TIERS, isValidGenerationModelId } = await import("../../src/model-catalog.js");
      const { assembleStation } = await import("../../src/assembly.js");
      const { serializeStation } = await import("../lib/serialization.js");
      console.debug("[generateStation] Modules imported");

      const effectiveTiers = modelId && isValidGenerationModelId(modelId)
        ? { ...GENERATION_MODEL_TIERS, premium: modelId }
        : GENERATION_MODEL_TIERS;
      effectiveModelId = effectiveTiers.premium;
      console.info("[generateStation] Using model", { modelId: effectiveModelId });

      const aiClient = new OpenRouterAITextClient({
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
        referer: "https://github.com/station-omega",
        title: "Station Omega",
      });

      // Progress callback → Convex mutation
      const statusMap: Record<string, { status: string; progress: number }> = {
        "Designing station layout...": { status: "topology", progress: 10 },
        "Engineering system failures...": { status: "systems", progress: 30 },
        "Designing mission objectives...": { status: "objectives", progress: 50 },
        "Generating creative content...": { status: "creative", progress: 70 },
        "Assembling station data...": { status: "assembly", progress: 90 },
      };

      let lastStatus: "pending" | "topology" | "systems" | "objectives" | "creative" | "assembly" | "video" | "complete" | "error" = "pending";
      let lastProgress = 0;

      const onProgress = (msg: string) => {
        const mapped: { status: string; progress: number } | undefined = statusMap[msg] as { status: string; progress: number } | undefined;
        if (mapped) {
          lastStatus = mapped.status as typeof lastStatus;
          lastProgress = mapped.progress;
        }
        const updatePromise = ctx.runMutation(internal.generationProgress.update, {
          id: progressId,
          status: lastStatus,
          message: msg,
          progress: lastProgress,
        });
        progressUpdatePromises.push(updatePromise);
      };

      // Accumulate per-layer AI prompts and responses for structured logging
      type LayerLogEntry = { label: string; content: string; timestamp: number };
      const layerLogs: LayerLogEntry[] = [];
      const debugLog = (label: string, content: string) => {
        layerLogs.push({ label, content, timestamp: Date.now() });
      };

      console.info("[generateStation] Running generation pipeline...");
      console.time("[generateStation] Generation pipeline");
      // Run the generation pipeline
      const { skeleton, creative } = await generateStation(
        { difficulty, characterClass, aiClient, modelTiers: effectiveTiers },
        onProgress,
        debugLog,
      );
      console.timeEnd("[generateStation] Generation pipeline");
      console.debug("[generateStation] Assembling station...");

      // Assemble into GeneratedStation
      const station = assembleStation(skeleton, creative);
      console.info("[generateStation] Station assembled", { stationName: station.stationName });

      // Serialize for Convex storage (Maps→Records, Sets→Arrays)
      const serialized = serializeStation(station);
      console.debug("[generateStation] Station serialized, saving to Convex...");

      // Save to Convex
      const stationId: Id<"stations"> = await ctx.runMutation(internal.stations.save, {
        stationName: station.stationName,
        briefing: station.briefing,
        difficulty,
        data: serialized,
      });
      console.info("[generateStation] Station saved", { stationId });

      // Persist per-layer AI logs (prompt + response pairs)
      try {
        // Extract LAYER-PROMPT / LAYER-RESPONSE / LAYER-USAGE entries for each layer
        const layerUsageMap = new Map<string, { inputTokens?: number; outputTokens?: number; costUsd?: number }>();
        for (const entry of layerLogs) {
          if (entry.label === "LAYER-USAGE") {
            // Content format: "layerName\n{...json...}"
            const nlIdx = entry.content.indexOf("\n");
            const layerName = nlIdx >= 0 ? entry.content.slice(0, nlIdx) : entry.content;
            try {
              layerUsageMap.set(layerName, JSON.parse(nlIdx >= 0 ? entry.content.slice(nlIdx + 1) : "{}") as Record<string, unknown>);
            } catch { /* skip malformed usage */ }
          }
        }

        const layerPairs: Array<{ layerName: string; prompt: string; response: string; startMs: number; endMs: number; usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number } }> = [];
        let currentPrompt: { label: string; content: string; timestamp: number } | null = null;
        for (const entry of layerLogs) {
          if (entry.label === "LAYER-PROMPT") {
            currentPrompt = entry;
          } else if (entry.label === "LAYER-RESPONSE" && currentPrompt) {
            // Extract layer name from content, e.g. "topology [attempt 1]\n..."
            const layerName = entry.content.split(" [")[0] ?? "unknown";
            layerPairs.push({
              layerName,
              prompt: currentPrompt.content,
              response: entry.content,
              startMs: currentPrompt.timestamp,
              endMs: entry.timestamp,
              usage: layerUsageMap.get(layerName),
            });
            currentPrompt = null;
          }
        }

        // Write one log entry per layer (parallel — order doesn't matter)
        await Promise.allSettled(
          layerPairs.map((pair) =>
            ctx.runMutation(internal.aiLogs.log, {
              provider: "openrouter" as const,
              operation: "station_generation" as const,
              stationId,
              modelId: effectiveModelId,
              prompt: pair.prompt,
              response: pair.response,
              status: "success" as const,
              durationMs: pair.endMs - pair.startMs,
              metadata: {
                difficulty,
                characterClass,
                stationName: station.stationName,
                layer: pair.layerName,
                ...(pair.usage ? { usage: pair.usage, costUsd: pair.usage.costUsd } : {}),
              },
            }),
          ),
        );
      } catch (logErr) {
        console.warn("[generateStation] Failed to write AI layer logs", logErr);
      }

      // Step 6: Generate briefing video (non-fatal)
      if (process.env.FAL_API_KEY) {
        await ctx.runMutation(internal.generationProgress.update, {
          id: progressId,
          status: "video",
          message: "Generating briefing video...",
          progress: 95,
        });

        try {
          const { buildBriefingVideoPrompt } = await import("../../src/video-prompts.js");
          const videoPrompt = buildBriefingVideoPrompt(station);
          if (!videoPrompt) {
            console.warn("[generateStation] No briefingVideoPrompt on station, skipping video generation");
            throw new Error("No briefingVideoPrompt");
          }
          const { FalVideoClient } = await import("../../src/io/fal-video-client.js");
          const { VIDEO_MODEL_ID, VIDEO_COST_USD } = await import("../../src/model-catalog.js");
          const videoStartMs = Date.now();
          const client = new FalVideoClient(process.env.FAL_API_KEY);
          const result = await client.generateVideo({ prompt: videoPrompt });

          const blob = new Blob([result.videoBytes as BlobPart], { type: result.mimeType });
          const storageId = await ctx.storage.store(blob);

          await ctx.runMutation(internal.stationImages.save, {
            stationId,
            cacheKey: "briefing_video",
            storageId,
            prompt: videoPrompt,
            category: "briefing_video" as const,
          });
          console.info("[generateStation] Briefing video generated and cached");

          try {
            await ctx.runMutation(internal.aiLogs.log, {
              provider: "fal" as const,
              operation: "video_generation" as const,
              stationId,
              modelId: VIDEO_MODEL_ID,
              prompt: videoPrompt,
              status: "success" as const,
              durationMs: Date.now() - videoStartMs,
              metadata: { cacheKey: "briefing_video", storageId, costUsd: VIDEO_COST_USD },
            });
          } catch { /* non-fatal */ }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[generateStation] Video generation failed (non-fatal)", { error: message });
        }
      }

      // Mark progress as complete
      await ctx.runMutation(internal.generationProgress.update, {
        id: progressId,
        status: "complete",
        message: `Station "${station.stationName}" ready!`,
        progress: 100,
        stationId,
      });
      console.info("[generateStation] Generation complete", { stationName: station.stationName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const stack = error instanceof Error ? error.stack : "";
      console.error("[generateStation] ERROR:", message, "\nStack:", stack);
      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "openrouter" as const,
          operation: "station_generation" as const,
          modelId: effectiveModelId,
          status: "error" as const,
          error: message,
          durationMs: Date.now() - genStartMs,
          metadata: { difficulty, characterClass },
        });
      } catch { /* logging must not mask the real error */ }
      await ctx.runMutation(internal.generationProgress.update, {
        id: progressId,
        status: "error",
        message: "Station generation failed",
        progress: 0,
        error: message,
      });
    } finally {
      if (progressUpdatePromises.length > 0) {
        await Promise.allSettled(progressUpdatePromises);
      }
    }

    return null;
  },
});
