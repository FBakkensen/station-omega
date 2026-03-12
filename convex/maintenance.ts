import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { deleteGameCascade } from "./lib/deleteGameCascade";

export const purgeGames = mutation({
  args: {
    gameIds: v.array(v.id("games")),
  },
  returns: v.object({
    requested: v.number(),
    messagesDeleted: v.number(),
    turnSegmentsDeleted: v.number(),
    choiceSetsDeleted: v.number(),
    turnLocksDeleted: v.number(),
    aiLogsDeleted: v.number(),
    stationImagesDeleted: v.number(),
    runHistoryDeleted: v.number(),
    gamesDeleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const uniqueGameIds = [...new Set(args.gameIds)];
    const totals = {
      requested: uniqueGameIds.length,
      messagesDeleted: 0,
      turnSegmentsDeleted: 0,
      choiceSetsDeleted: 0,
      turnLocksDeleted: 0,
      aiLogsDeleted: 0,
      stationImagesDeleted: 0,
      runHistoryDeleted: 0,
      gamesDeleted: 0,
    };

    for (const gameId of uniqueGameIds) {
      const deleted = await deleteGameCascade(ctx, gameId);
      totals.messagesDeleted += deleted.messagesDeleted;
      totals.turnSegmentsDeleted += deleted.turnSegmentsDeleted;
      totals.choiceSetsDeleted += deleted.choiceSetsDeleted;
      totals.turnLocksDeleted += deleted.turnLocksDeleted;
      totals.aiLogsDeleted += deleted.aiLogsDeleted;
      totals.stationImagesDeleted += deleted.stationImagesDeleted;
      totals.runHistoryDeleted += deleted.runHistoryDeleted;
      totals.gamesDeleted += deleted.gamesDeleted;
    }

    return totals;
  },
});

export const purgeOrphans = mutation({
  args: {},
  returns: v.object({
    messagesDeleted: v.number(),
    turnSegmentsDeleted: v.number(),
    choiceSetsDeleted: v.number(),
    turnLocksDeleted: v.number(),
    aiLogsDeleted: v.number(),
    stationImagesDeleted: v.number(),
    runHistoryDeleted: v.number(),
    generationProgressDeleted: v.number(),
  }),
  handler: async (ctx) => {
    const stations = await ctx.db.query("stations").collect();
    const games = await ctx.db.query("games").collect();
    const stationIds = new Set(stations.map((station) => station._id));
    const gameIds = new Set(games.map((game) => game._id));

    let messagesDeleted = 0;
    let turnSegmentsDeleted = 0;
    let choiceSetsDeleted = 0;
    let turnLocksDeleted = 0;
    let aiLogsDeleted = 0;
    let stationImagesDeleted = 0;
    let runHistoryDeleted = 0;
    let generationProgressDeleted = 0;

    for (const message of await ctx.db.query("messages").collect()) {
      if (!gameIds.has(message.gameId)) {
        await ctx.db.delete(message._id);
        messagesDeleted++;
      }
    }

    for (const segment of await ctx.db.query("turnSegments").collect()) {
      if (!gameIds.has(segment.gameId)) {
        await ctx.db.delete(segment._id);
        turnSegmentsDeleted++;
      }
    }

    for (const choiceSet of await ctx.db.query("choiceSets").collect()) {
      if (!gameIds.has(choiceSet.gameId)) {
        await ctx.db.delete(choiceSet._id);
        choiceSetsDeleted++;
      }
    }

    for (const turnLock of await ctx.db.query("turnLocks").collect()) {
      if (!gameIds.has(turnLock.gameId)) {
        await ctx.db.delete(turnLock._id);
        turnLocksDeleted++;
      }
    }

    for (const log of await ctx.db.query("aiLogs").collect()) {
      const missingGame = log.gameId !== undefined && !gameIds.has(log.gameId);
      const missingStation = log.stationId !== undefined && !stationIds.has(log.stationId);
      if (missingGame || missingStation) {
        await ctx.db.delete(log._id);
        aiLogsDeleted++;
      }
    }

    for (const image of await ctx.db.query("stationImages").collect()) {
      const missingGame = image.gameId !== undefined && !gameIds.has(image.gameId);
      const missingStation = !stationIds.has(image.stationId);
      if (missingGame || missingStation) {
        await ctx.storage.delete(image.storageId);
        await ctx.db.delete(image._id);
        stationImagesDeleted++;
      }
    }

    for (const run of await ctx.db.query("runHistory").collect()) {
      if (run.gameId !== undefined && !gameIds.has(run.gameId)) {
        await ctx.db.delete(run._id);
        runHistoryDeleted++;
      }
    }

    for (const progress of await ctx.db.query("generationProgress").collect()) {
      if (progress.stationId !== undefined && !stationIds.has(progress.stationId)) {
        await ctx.db.delete(progress._id);
        generationProgressDeleted++;
      }
    }

    return {
      messagesDeleted,
      turnSegmentsDeleted,
      choiceSetsDeleted,
      turnLocksDeleted,
      aiLogsDeleted,
      stationImagesDeleted,
      runHistoryDeleted,
      generationProgressDeleted,
    };
  },
});