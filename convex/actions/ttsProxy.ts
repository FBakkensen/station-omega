"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

const INWORLD_API_BASE = "https://api.inworld.ai/tts/v1";
const INWORLD_MODEL = "inworld-tts-1.5-max";
const INWORLD_SAMPLE_RATE = 48000;
const INWORLD_BITS_PER_SAMPLE = 16;
const INWORLD_CHANNELS = 1;

/** Build a WAV file header for raw PCM data. */
function createWavHeader(dataSize: number): Buffer {
  const byteRate = INWORLD_SAMPLE_RATE * INWORLD_CHANNELS * (INWORLD_BITS_PER_SAMPLE / 8);
  const blockAlign = INWORLD_CHANNELS * (INWORLD_BITS_PER_SAMPLE / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(INWORLD_CHANNELS, 22);
  header.writeUInt32LE(INWORLD_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(INWORLD_BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

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
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "TTS not configured", status: 503 };
    }

    const response = await fetch(`${INWORLD_API_BASE}/voice:stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        text: args.text,
        voice_id: args.voiceId,
        model_id: INWORLD_MODEL,
        audio_config: {
          audio_encoding: "LINEAR16",
          sample_rate_hertz: INWORLD_SAMPLE_RATE,
          speaking_rate: args.speakingRate,
        },
        temperature: args.temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      return { ok: false as const, error: `Inworld API error: ${errorText}`, status: 502 };
    }

    // Parse NDJSON streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false as const, error: "No response body", status: 502 };
    }

    const decoder = new TextDecoder();
    let textBuffer = "";
    const rawChunks: Buffer[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      textBuffer += decoder.decode(value, { stream: true });
      const lines = textBuffer.split("\n");
      textBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            result?: { audioContent?: string };
          };
          if (parsed.result?.audioContent) {
            const audioChunk = Buffer.from(parsed.result.audioContent, "base64");
            const isRiff = audioChunk.subarray(0, 4).toString() === "RIFF";
            if (isRiff && audioChunk.length > 44) {
              rawChunks.push(audioChunk.subarray(44));
            } else if (!isRiff) {
              rawChunks.push(audioChunk);
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process remaining buffer
    if (textBuffer.trim()) {
      try {
        const parsed = JSON.parse(textBuffer) as {
          result?: { audioContent?: string };
        };
        if (parsed.result?.audioContent) {
          const audioChunk = Buffer.from(parsed.result.audioContent, "base64");
          if (
            audioChunk.length > 44 &&
            audioChunk.subarray(0, 4).toString() === "RIFF"
          ) {
            rawChunks.push(audioChunk.subarray(44));
          } else {
            rawChunks.push(audioChunk);
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }

    const combinedAudio = Buffer.concat(rawChunks);
    const wavHeader = createWavHeader(combinedAudio.byteLength);
    const wavBuffer = Buffer.concat([wavHeader, combinedAudio]);

    return { ok: true as const, wavBase64: wavBuffer.toString("base64") };
  },
});
