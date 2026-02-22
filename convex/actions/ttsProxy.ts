"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * Internal TTS action — called from the HTTP action in http.ts.
 * Returns base64-encoded WAV audio.
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
  handler: async (_ctx, args) => {
    const { InworldTTSClient } = await import("../../src/io/inworld-tts-client.js");

    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "TTS not configured", status: 503 };
    }

    const ttsClient = new InworldTTSClient(apiKey);
    return ttsClient.generateSpeech(args);
  },
});
