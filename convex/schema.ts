import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
    * Generated station data (rooms, items, objectives, map).
   * Stored as a single document with v.any() for deeply nested game data.
   * Immutable after generation — per-game mutations go in the games table.
   */
  stations: defineTable({
    stationName: v.string(),
    briefing: v.string(),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    /** Full serialized station data (rooms and items as Records, Sets as Arrays). */
    data: v.any(),
  }),

  /**
   * Active game session state.
   * Mutable per-turn — serialized GameState with overrides for station mutations.
   */
  games: defineTable({
    stationId: v.id("stations"),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    /** Serialized GameState (Sets→Arrays, Maps→Records). */
    state: v.any(),
    /** Per-game room overrides (loot changes, modifier changes). */
    roomOverrides: v.any(),
    /** Per-game objective chain override. */
    objectivesOverride: v.optional(v.any()),
    /** Room drops from defeated enemies or events. */
    roomDrops: v.optional(v.any()),
    /** Whether the game has ended. */
    isOver: v.boolean(),
    /** Whether the player won. */
    won: v.boolean(),
    /** Current turn number (denormalized for queries). */
    turnCount: v.number(),
    /** Timestamp of last turn. */
    lastTurnAt: v.number(),
  }).index("by_station", ["stationId"]),

  /**
   * Conversation history — one doc per message.
   * Append-only, ordered by creation time.
   */
  messages: defineTable({
    gameId: v.id("games"),
    role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
    content: v.string(),
  }).index("by_game", ["gameId"]),

  /**
   * Streamed AI segments per turn — for reconnection and history replay.
   * Append-only.
   */
  turnSegments: defineTable({
    gameId: v.id("games"),
    turnNumber: v.number(),
    segmentIndex: v.number(),
    segment: v.object({
      type: v.union(
        v.literal("narration"),
        v.literal("dialogue"),
        v.literal("thought"),
        v.literal("station_pa"),
        v.literal("crew_echo"),
        v.literal("diagnostic_readout"),
        v.literal("player_action"),
      ),
      text: v.string(),
      npcId: v.union(v.string(), v.null()),
      crewName: v.union(v.string(), v.null()),
      entityRefs: v.optional(v.array(v.object({
        type: v.union(v.literal("room"), v.literal("item")),
        id: v.string(),
      }))),
    }),
  }).index("by_game_turn", ["gameId", "turnNumber"]),

  /**
   * Interactive choice buttons from suggest_actions tool.
   * One set per turn, replaced each turn.
   */
  choiceSets: defineTable({
    gameId: v.id("games"),
    turnNumber: v.number(),
    title: v.string(),
    choices: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        description: v.string(),
        risk: v.optional(
          v.union(
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("critical"),
          ),
        ),
        timeCost: v.optional(v.string()),
        consequence: v.optional(v.string()),
      }),
    ),
  }).index("by_game", ["gameId"]),

  /**
   * Completed game scores for leaderboard.
   * Immutable after creation.
   */
  runHistory: defineTable({
    gameId: v.optional(v.id("games")),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
    storyArc: v.string(),
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    won: v.boolean(),
    endingId: v.union(v.string(), v.null()),
    score: v.object({
      speed: v.number(),
      engineeringEfficiency: v.number(),
      exploration: v.number(),
      resourcefulness: v.number(),
      completion: v.number(),
      total: v.number(),
      grade: v.string(),
    }),
    turnCount: v.number(),
    duration: v.number(),
    date: v.string(),
  }).index("by_game", ["gameId"]),

  /**
   * Station generation progress — reactive for loading UI.
   * One doc per generation in progress, deleted after completion.
   */
  generationProgress: defineTable({
    status: v.union(
      v.literal("pending"),
      v.literal("topology"),
      v.literal("systems"),
      v.literal("objectives"),
      v.literal("creative"),
      v.literal("assembly"),
      v.literal("video"),
      v.literal("complete"),
      v.literal("error"),
    ),
    /** Human-readable status message. */
    message: v.string(),
    /** 0-100 progress percentage. */
    progress: v.number(),
    /** Error message if status is "error". */
    error: v.optional(v.string()),
    /** Station ID once generation is complete. */
    stationId: v.optional(v.id("stations")),
    /** Config used for generation. */
    config: v.object({
      difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
      characterClass: v.union(
        v.literal("engineer"),
        v.literal("scientist"),
        v.literal("medic"),
        v.literal("commander"),
      ),
    }),
  }),

  /**
   * Prevent concurrent turns on the same game.
   * Ephemeral — deleted after turn completes.
   */
  turnLocks: defineTable({
    gameId: v.id("games"),
    lockedAt: v.number(),
  }).index("by_game", ["gameId"]),

  /**
   * Cached AI-generated images.
    * Room and item images are scoped per game (narrative-informed).
   * Briefing images are scoped per station (shared across games).
   */
  /**
   * Structured AI call logs — prompts, responses, timing, status.
   * Auto-pruned by daily cron after 30 days.
   */
  aiLogs: defineTable({
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
    /** Full prompt / input text. */
    prompt: v.optional(v.string()),
    /** Full response text/JSON, or storageId reference for binary outputs. */
    response: v.optional(v.string()),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("cache_hit")),
    error: v.optional(v.string()),
    durationMs: v.number(),
    /** Provider-specific extras (token counts, image size, voice config, storageId, etc.). */
    metadata: v.optional(v.any()),
  })
    .index("by_station", ["stationId"])
    .index("by_game_turn", ["gameId", "turnNumber"])
    .index("by_provider", ["provider"])
    .index("by_operation", ["operation"])
    .index("by_status", ["status"]),

  stationImages: defineTable({
    stationId: v.id("stations"),
    /** Game ID for per-game scoping. Undefined for station-scoped images (briefings). */
    gameId: v.optional(v.id("games")),
    /** Cache key for deduplication (e.g., "room:reactor", "briefing"). */
    cacheKey: v.string(),
    /** Convex file storage blob ID. */
    storageId: v.id("_storage"),
    /** The prompt used to generate this image. */
    prompt: v.string(),
    /** Image category for UI rendering. */
    category: v.union(
      v.literal("room_scene"),
      v.literal("briefing"),
      v.literal("briefing_video"),
      v.literal("item_image"),
      v.literal("objective_video"),
    ),
  })
    .index("by_station_cache", ["stationId", "cacheKey"])
    .index("by_game_cache", ["gameId", "cacheKey"]),
});
