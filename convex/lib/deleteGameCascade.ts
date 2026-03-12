import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type GameMessage = { _id: Id<"messages"> };
type GameSegment = { _id: Id<"turnSegments"> };
type GameChoiceSet = { _id: Id<"choiceSets"> };
type GameLock = { _id: Id<"turnLocks"> };
type GameAiLog = { _id: Id<"aiLogs"> };
type GameImage = { _id: Id<"stationImages">; storageId: Id<"_storage"> };
type RunHistoryEntry = { _id: Id<"runHistory">; gameId?: Id<"games"> };

export type GameCascadeDeleteSummary = {
  messagesDeleted: number;
  turnSegmentsDeleted: number;
  choiceSetsDeleted: number;
  turnLocksDeleted: number;
  aiLogsDeleted: number;
  stationImagesDeleted: number;
  runHistoryDeleted: number;
  gamesDeleted: number;
};

export async function deleteGameCascade(
  ctx: Pick<MutationCtx, "db" | "storage">,
  gameId: Id<"games">,
): Promise<GameCascadeDeleteSummary> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect() as GameMessage[];
  for (const message of messages) {
    await ctx.db.delete(message._id);
  }

  const turnSegments = await ctx.db
    .query("turnSegments")
    .withIndex("by_game_turn", (q) => q.eq("gameId", gameId))
    .collect() as GameSegment[];
  for (const segment of turnSegments) {
    await ctx.db.delete(segment._id);
  }

  const choiceSets = await ctx.db
    .query("choiceSets")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect() as GameChoiceSet[];
  for (const choiceSet of choiceSets) {
    await ctx.db.delete(choiceSet._id);
  }

  const turnLocks = await ctx.db
    .query("turnLocks")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect() as GameLock[];
  for (const turnLock of turnLocks) {
    await ctx.db.delete(turnLock._id);
  }

  const aiLogs = await ctx.db
    .query("aiLogs")
    .withIndex("by_game_turn", (q) => q.eq("gameId", gameId))
    .collect() as GameAiLog[];
  for (const log of aiLogs) {
    await ctx.db.delete(log._id);
  }

  const stationImages = await ctx.db
    .query("stationImages")
    .withIndex("by_game_cache", (q) => q.eq("gameId", gameId))
    .collect() as GameImage[];
  for (const image of stationImages) {
    await ctx.storage.delete(image.storageId);
    await ctx.db.delete(image._id);
  }

  const linkedRunHistory = await ctx.db
    .query("runHistory")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect() as RunHistoryEntry[];
  for (const entry of linkedRunHistory) {
    await ctx.db.delete(entry._id);
  }

  await ctx.db.delete(gameId);

  return {
    messagesDeleted: messages.length,
    turnSegmentsDeleted: turnSegments.length,
    choiceSetsDeleted: choiceSets.length,
    turnLocksDeleted: turnLocks.length,
    aiLogsDeleted: aiLogs.length,
    stationImagesDeleted: stationImages.length,
    runHistoryDeleted: linkedRunHistory.length,
    gamesDeleted: 1,
  };
}