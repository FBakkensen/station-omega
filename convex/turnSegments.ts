import type { Id } from "./_generated/dataModel";
import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

type SegmentType =
  | "narration"
  | "dialogue"
  | "thought"
  | "station_pa"
  | "crew_echo"
  | "diagnostic_readout"
  | "player_action";

type SegmentDoc = {
  _id: Id<"turnSegments">;
  _creationTime: number;
  gameId: Id<"games">;
  turnNumber: number;
  segmentIndex: number;
  segment: {
    type: SegmentType;
    text: string;
    npcId: string | null;
    crewName: string | null;
    entityRefs?: unknown;
  };
};

type NormalizedEntityRef = {
  type: "room" | "item";
  id: string;
};

type NormalizedSegmentDoc = Omit<SegmentDoc, "segment"> & {
  segment: {
    type: SegmentType;
    text: string;
    npcId: string | null;
    crewName: string | null;
    entityRefs?: NormalizedEntityRef[];
  };
};

const segmentValidator = v.object({
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
});

function normalizeEntityRefs(entityRefs: unknown): NormalizedEntityRef[] | undefined {
  if (!Array.isArray(entityRefs)) {
    return undefined;
  }

  const normalized = entityRefs.filter((ref): ref is NormalizedEntityRef => {
    if (typeof ref !== "object" || ref === null) {
      return false;
    }

    const candidate = ref as { type?: unknown; id?: unknown };
    return (candidate.type === "room" || candidate.type === "item") && typeof candidate.id === "string";
  }).slice(0, 3);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSegmentRow(row: SegmentDoc): NormalizedSegmentDoc {
  const entityRefs = normalizeEntityRefs(row.segment.entityRefs);
  return {
    ...row,
    segment: {
      type: row.segment.type,
      text: row.segment.text,
      npcId: row.segment.npcId,
      crewName: row.segment.crewName,
      ...(entityRefs ? { entityRefs } : {}),
    },
  };
}

async function collectNormalizedSegments(
  segmentsPromise: Promise<SegmentDoc[]>,
): Promise<NormalizedSegmentDoc[]> {
  const segments = await segmentsPromise;
  return segments.map(normalizeSegmentRow);
}

/** Get all segments for a specific turn. */
export const listByTurn = query({
  args: { gameId: v.id("games"), turnNumber: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("turnSegments"),
      _creationTime: v.number(),
      gameId: v.id("games"),
      turnNumber: v.number(),
      segmentIndex: v.number(),
      segment: segmentValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return collectNormalizedSegments(
      ctx.db
        .query("turnSegments")
        .withIndex("by_game_turn", (q) =>
          q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
        )
        .collect() as Promise<SegmentDoc[]>,
    );
  },
});

/** Get the latest turn's segments for a game. */
export const listLatestTurn = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return [];

    return collectNormalizedSegments(
      ctx.db
        .query("turnSegments")
        .withIndex("by_game_turn", (q) =>
          q.eq("gameId", args.gameId).eq("turnNumber", game.turnCount),
        )
        .collect() as Promise<SegmentDoc[]>,
    );
  },
});

/** Get all segments for a game across all turns, ordered by turn then index. */
export const listAllForGame = query({
  args: { gameId: v.id("games") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return collectNormalizedSegments(
      ctx.db
        .query("turnSegments")
        .withIndex("by_game_turn", (q) => q.eq("gameId", args.gameId))
        .collect() as Promise<SegmentDoc[]>,
    );
  },
});

/** Save a segment (called from streamTurn action). */
export const save = internalMutation({
  args: {
    gameId: v.id("games"),
    turnNumber: v.number(),
    segmentIndex: v.number(),
    segment: segmentValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("turnSegments", {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
      segmentIndex: args.segmentIndex,
      segment: args.segment,
    });
    return null;
  },
});
