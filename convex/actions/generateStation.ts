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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { progressId, difficulty, characterClass } = args;
    console.log("[generateStation] Starting generation, progressId:", progressId, "difficulty:", difficulty, "class:", characterClass);

    try {
      // Dynamic import of the generation pipeline (ESM from src/)
      console.log("[generateStation] Importing modules...");
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const { generateStation } = await import("../../src/generation/index.js");
      const { assembleStation } = await import("../../src/assembly.js");
      const { serializeStation } = await import("../lib/serialization.js");
      console.log("[generateStation] Modules imported successfully");

      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
        headers: {
          "HTTP-Referer": "https://github.com/station-omega",
          "X-Title": "Station Omega",
        },
      });
      const model = openrouter("anthropic/claude-opus-4.6");

      // Progress callback → Convex mutation
      const statusMap: Record<string, { status: string; progress: number }> = {
        "Designing station layout...": { status: "topology", progress: 10 },
        "Engineering system failures...": { status: "systems", progress: 30 },
        "Designing mission objectives...": { status: "objectives", progress: 50 },
        "Generating creative content...": { status: "creative", progress: 70 },
        "Assembling station data...": { status: "assembly", progress: 90 },
      };

      let lastStatus: "pending" | "topology" | "systems" | "objectives" | "creative" | "assembly" | "complete" | "error" = "pending";
      let lastProgress = 0;

      const onProgress = (msg: string) => {
        const mapped: { status: string; progress: number } | undefined = statusMap[msg] as { status: string; progress: number } | undefined;
        if (mapped) {
          lastStatus = mapped.status as typeof lastStatus;
          lastProgress = mapped.progress;
        }
        void ctx.runMutation(internal.generationProgress.update, {
          id: progressId,
          status: lastStatus,
          message: msg,
          progress: lastProgress,
        });
      };

      console.log("[generateStation] Running generation pipeline...");
      // Run the generation pipeline
      const { skeleton, creative } = await generateStation(
        { difficulty, characterClass, model },
        onProgress,
      );
      console.log("[generateStation] Generation pipeline complete, assembling station...");

      // Assemble into GeneratedStation
      const station = assembleStation(skeleton, creative);
      console.log("[generateStation] Station assembled:", station.stationName);

      // Serialize for Convex storage (Maps→Records, Sets→Arrays)
      const serialized = serializeStation(station);
      console.log("[generateStation] Station serialized, saving to Convex...");

      // Save to Convex
      const stationId: Id<"stations"> = await ctx.runMutation(internal.stations.save, {
        stationName: station.stationName,
        briefing: station.briefing,
        difficulty,
        data: serialized,
      });
      console.log("[generateStation] Station saved, stationId:", stationId);

      // Mark progress as complete
      await ctx.runMutation(internal.generationProgress.update, {
        id: progressId,
        status: "complete",
        message: `Station "${station.stationName}" ready!`,
        progress: 100,
        stationId,
      });
      console.log("[generateStation] Progress marked complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const stack = error instanceof Error ? error.stack : "";
      console.error("[generateStation] ERROR:", message, "\nStack:", stack);
      await ctx.runMutation(internal.generationProgress.update, {
        id: progressId,
        status: "error",
        message: "Station generation failed",
        progress: 0,
        error: message,
      });
    }

    return null;
  },
});
