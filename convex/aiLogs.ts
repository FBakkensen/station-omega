import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ── Internal mutations ───────────────────────────────────────────────

/** Write a structured AI log entry. Fire-and-forget from actions. */
export const log = internalMutation({
  args: {
    provider: v.union(v.literal("openrouter"), v.literal("fal"), v.literal("inworld")),
    operation: v.union(
      v.literal("station_generation"),
      v.literal("game_turn"),
      v.literal("image_generation"),
      v.literal("video_generation"),
      v.literal("tts"),
    ),
    stationId: v.optional(v.id("stations")),
    gameId: v.optional(v.id("games")),
    turnNumber: v.optional(v.number()),
    modelId: v.optional(v.string()),
    prompt: v.optional(v.string()),
    response: v.optional(v.string()),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("cache_hit")),
    error: v.optional(v.string()),
    durationMs: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("aiLogs", args);
    return null;
  },
});

/** Delete AI log entries older than 30 days. Called by daily cron. */
export const prune = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("aiLogs")
      .order("asc")
      .take(4000);
    let deleted = 0;
    for (const doc of old) {
      if (doc._creationTime < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }
    return deleted;
  },
});

// ── Public queries (callable via `npx convex run`) ───────────────────

/** Truncate a string for summary display. */
function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Summarize a log entry (truncated prompt/response for list views). */
function summarize(doc: Record<string, unknown>) {
  return {
    ...doc,
    prompt: truncate(doc.prompt as string | undefined, 200),
    response: truncate(doc.response as string | undefined, 200),
  };
}

/** Recent AI logs. Optional filters: provider, operation, status. */
export const recent = query({
  args: {
    limit: v.optional(v.number()),
    provider: v.optional(v.union(v.literal("openrouter"), v.literal("fal"), v.literal("inworld"))),
    operation: v.optional(v.union(
      v.literal("station_generation"),
      v.literal("game_turn"),
      v.literal("image_generation"),
      v.literal("video_generation"),
      v.literal("tts"),
    )),
    status: v.optional(v.union(v.literal("success"), v.literal("error"), v.literal("cache_hit"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const take = args.limit ?? 50;
    let docs;
    const { provider, operation, status } = args;
    if (provider) {
      docs = await ctx.db
        .query("aiLogs")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .order("desc")
        .take(take);
    } else if (operation) {
      docs = await ctx.db
        .query("aiLogs")
        .withIndex("by_operation", (q) => q.eq("operation", operation))
        .order("desc")
        .take(take);
    } else if (status) {
      docs = await ctx.db
        .query("aiLogs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(take);
    } else {
      docs = await ctx.db
        .query("aiLogs")
        .order("desc")
        .take(take);
    }
    return docs.map(summarize);
  },
});

/** All AI logs for a game, optionally filtered by turn number. */
export const byGame = query({
  args: {
    gameId: v.id("games"),
    turnNumber: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { turnNumber } = args;
    const docs = turnNumber !== undefined
      ? await ctx.db
          .query("aiLogs")
          .withIndex("by_game_turn", (q) =>
            q.eq("gameId", args.gameId).eq("turnNumber", turnNumber),
          )
          .order("desc")
          .take(500)
      : await ctx.db
          .query("aiLogs")
          .withIndex("by_game_turn", (q) => q.eq("gameId", args.gameId))
          .order("desc")
          .take(500);
    return docs.map(summarize);
  },
});

/** All AI logs for a station (generation + all game runs). */
export const byStation = query({
  args: { stationId: v.id("stations") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("aiLogs")
      .withIndex("by_station", (q) => q.eq("stationId", args.stationId))
      .order("desc")
      .take(500);
    return docs.map(summarize);
  },
});

/** Recent error logs only. */
export const errors = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("aiLogs")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .order("desc")
      .take(args.limit ?? 20);
    return docs.map(summarize);
  },
});

/** Full detail for a single log entry (un-truncated prompt + response). */
export const detail = query({
  args: { id: v.id("aiLogs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Per-game cost summary across all AI services. */
export const gameCostSummary = query({
  args: {
    gameId: v.id("games"),
    stationId: v.id("stations"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Fetch game-specific logs (turns, images, TTS)
    const gameLogs = await ctx.db
      .query("aiLogs")
      .withIndex("by_game_turn", (q) => q.eq("gameId", args.gameId))
      .take(2000);

    // Fetch station generation logs
    const stationLogs = await ctx.db
      .query("aiLogs")
      .withIndex("by_station", (q) => q.eq("stationId", args.stationId))
      .take(500);

    // Filter station logs to generation + video only (images are counted via gameLogs)
    const genLogs = stationLogs.filter(
      (l) =>
        l.operation === "station_generation" ||
        l.operation === "video_generation"
    );

    const summary = {
      generation: { count: 0, costUsd: 0 },
      turns: { count: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
      images: { count: 0, costUsd: 0, cacheHits: 0 },
      video: { count: 0, costUsd: 0 },
      tts: { count: 0, costUsd: 0, totalChars: 0 },
      totalCostUsd: 0,
      stationCostUsd: 0,
    };

    for (const log of genLogs) {
      const meta = log.metadata as Record<string, unknown> | undefined;
      const cost = (meta?.costUsd as number | undefined) ?? 0;
      if (log.operation === "station_generation") {
        summary.generation.count++;
        summary.generation.costUsd += cost;
      } else if (log.operation === "video_generation") {
        summary.video.count++;
        summary.video.costUsd += cost;
      }
    }

    for (const log of gameLogs) {
      const meta = log.metadata as Record<string, unknown> | undefined;
      const cost = (meta?.costUsd as number | undefined) ?? 0;
      switch (log.operation) {
        case "game_turn":
          summary.turns.count++;
          summary.turns.costUsd += cost;
          if (meta?.usage && typeof meta.usage === "object") {
            const usage = meta.usage as Record<string, unknown>;
            summary.turns.inputTokens += (usage.inputTokens as number | undefined) ?? 0;
            summary.turns.outputTokens += (usage.outputTokens as number | undefined) ?? 0;
          }
          break;
        case "image_generation":
          if (log.status === "cache_hit") summary.images.cacheHits++;
          else summary.images.count++;
          summary.images.costUsd += cost;
          break;
        case "tts":
          summary.tts.count++;
          summary.tts.costUsd += cost;
          if (meta?.textLength && typeof meta.textLength === "number") {
            summary.tts.totalChars += meta.textLength;
          }
          break;
      }
    }

    summary.stationCostUsd =
      summary.generation.costUsd +
      summary.video.costUsd;
    summary.totalCostUsd =
      summary.turns.costUsd +
      summary.images.costUsd +
      summary.tts.costUsd;

    return summary;
  },
});

/** Aggregate stats: counts by provider/operation, error rate. */
export const stats = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const all = await ctx.db.query("aiLogs").take(10000);
    const byProvider: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    let errorCount = 0;
    let totalDurationMs = 0;

    for (const doc of all) {
      byProvider[doc.provider] = (byProvider[doc.provider] ?? 0) + 1;
      byOperation[doc.operation] = (byOperation[doc.operation] ?? 0) + 1;
      if (doc.status === "error") errorCount++;
      totalDurationMs += doc.durationMs;
    }

    return {
      totalCount: all.length,
      errorCount,
      avgDurationMs: all.length > 0 ? Math.round(totalDurationMs / all.length) : 0,
      byProvider,
      byOperation,
    };
  },
});
