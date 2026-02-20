import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ttsHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as {
      text: string;
      voiceId: string;
      temperature: number;
      speakingRate: number;
    };

    const result = await ctx.runAction(internal.actions.ttsProxy.generateTTS, {
      text: body.text,
      voiceId: body.voiceId,
      temperature: body.temperature,
      speakingRate: body.speakingRate,
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Decode base64 WAV back to binary
    const wavBytes = Uint8Array.from(atob(result.wavBase64), (c) =>
      c.charCodeAt(0),
    );

    return new Response(wavBytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wavBytes.byteLength),
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "TTS proxy error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
});

http.route({
  path: "/api/tts",
  method: "POST",
  handler: ttsHandler,
});

http.route({
  path: "/api/tts",
  method: "OPTIONS",
  handler: ttsHandler,
});

export default http;
