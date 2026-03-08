"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Internal TTS action — called from the HTTP action in http.ts.
 * Returns base64-encoded WAV audio. Also persists audio to _storage for replay.
 */
export const generateTTS = internalAction({
  args: {
    text: v.string(),
    voiceId: v.string(),
    temperature: v.number(),
    speakingRate: v.number(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), wavBase64: v.string() }),
    v.object({ ok: v.literal(false), error: v.string(), status: v.number() }),
  ),
  handler: async (ctx, args) => {
    const { InworldTTSClient } = await import("../../src/io/inworld-tts-client.js");
    const startMs = Date.now();

    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "TTS not configured", status: 503 };
    }

    const ttsClient = new InworldTTSClient(apiKey);
    const result = await ttsClient.generateSpeech(args);

    // Persist audio + log (non-fatal — must not break the TTS response)
    try {
      let storageId: string | undefined;

      if (result.ok && result.wavBase64) {
        const wavBytes = Buffer.from(result.wavBase64, "base64");
        const blob = new Blob([wavBytes], { type: "audio/wav" });
        storageId = await ctx.storage.store(blob);
      }

      await ctx.runMutation(internal.aiLogs.log, {
        provider: "inworld" as const,
        operation: "tts" as const,
        prompt: args.text,
        status: result.ok ? ("success" as const) : ("error" as const),
        error: result.ok ? undefined : result.error,
        durationMs: Date.now() - startMs,
        metadata: {
          voiceId: args.voiceId,
          temperature: args.temperature,
          speakingRate: args.speakingRate,
          textLength: args.text.length,
          ...(storageId ? { storageId } : {}),
        },
      });
    } catch { /* non-fatal */ }

    return result;
  },
});
