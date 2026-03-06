"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { buildTurnMessages, mapChoicesForPersistence, isValidSegmentType, shouldDowngradeDialogue } from "./streamTurn.helpers";
import { EventTracker } from "../../src/events.js";
import type { EventType } from "../../src/types.js";

/**
 * Process an AI turn — runs the full game loop server-side.
 *
 * This is a Node.js action (for AI SDK access) scheduled by the `startTurn` mutation.
 * Instead of streaming via HTTP, it writes segments reactively to the DB as they
 * arrive, so the client's useQuery subscription picks them up in real-time.
 *
 * Architecture:
 * 1. Load game + station + messages from Convex
 * 2. Reconstruct in-memory GameContext (deserialize Maps/Sets)
 * 3. Build system prompt + per-turn context
 * 4. Call AI text client with model, tools, messages
 * 5. As segments complete → write to turnSegments table (reactive)
 * 6. After completion → persist state + messages to Convex
 */
export const processAITurn = internalAction({
  args: {
    gameId: v.id("games"),
    playerInput: v.string(),
    turnNumber: v.number(),
    modelId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { gameId, playerInput, turnNumber } = args;
    console.info("[processAITurn] Turn started", { gameId, turnNumber, input: playerInput });

    try {
      // ── Load game data from Convex ───────────────────────────────────
      console.debug("[processAITurn] Loading game data...");
      const game = await ctx.runQuery(internal.games.getInternal, {
        id: gameId,
      });
      if (!game) throw new Error("Game not found");
      console.debug("[processAITurn] Game loaded", { stationId: game.stationId });

      const station = await ctx.runQuery(internal.stations.getInternal, {
        id: game.stationId,
      });
      if (!station) throw new Error("Station not found");

      const messagesDocs = await ctx.runQuery(internal.messages.listInternal, {
        gameId,
      });

      // ── Dynamic imports (ESM from src/) ──────────────────────────────
      const { OpenRouterAITextClient } = await import("../../src/io/openrouter-ai-client.js");
      const { GAME_MASTER_MODEL_ID } = await import("../../src/models.js");
      const { createGameToolSets } = await import("../../src/tools.js");
      const { buildOrchestratorPrompt } = await import("../../src/prompt.js");
      const { buildTurnContext } = await import("../../src/turn-context.js");
      const { GameResponseSchema } = await import("../../src/schema.js");
      const { deserializeStation, deserializeGameState, serializeGameState } =
        await import("../lib/serialization.js");
      const { getBuild } = await import("../../src/character.js");
      const { StreamingSegmentParser } = await import(
        "../../src/json-stream-parser.js"
      );

      // ── Reconstruct in-memory state ──────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const stationObj = deserializeStation(station.data);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const state = deserializeGameState(game.state);
      const build = getBuild(state.characterClass);

      // Apply per-game overrides to station
      if (game.npcOverrides) {
        for (const [npcId, overrides] of Object.entries(
          game.npcOverrides as Record<string, Record<string, unknown>>,
        )) {
          const npc = stationObj.npcs.get(npcId);
          if (npc) Object.assign(npc, overrides);
        }
      }
      if (game.roomOverrides) {
        for (const [roomId, overrides] of Object.entries(
          game.roomOverrides as Record<string, Record<string, unknown>>,
        )) {
          const room = stationObj.rooms.get(roomId);
          if (room) Object.assign(room, overrides);
        }
      }
      if (game.objectivesOverride) {
        Object.assign(stationObj.objectives, game.objectivesOverride);
      }

      // Set current room on first turn (entry room)
      if (!state.currentRoom) {
        state.currentRoom = stationObj.entryRoomId;
        state.roomsVisited.add(state.currentRoom);
        state.roomVisitCount.set(state.currentRoom, 1);
      }

      // ── EventTracker: restore cooldowns and process pre-turn events ──
      const tracker = new EventTracker();
      for (const [k, cooldownVal] of Object.entries(state.eventCooldowns)) {
        tracker.lastTriggered.set(k as EventType, cooldownVal);
      }

      const PRE_TURN_MINUTES = 5;
      const preEventCtx = tracker.tickActiveEvents(state, PRE_TURN_MINUTES);
      const preCascadeCtx = tracker.processCascadeEffects(state, stationObj, PRE_TURN_MINUTES);
      const newEvent = tracker.checkRandomEvent(state);
      if (newEvent) {
        state.activeEvents.push(newEvent);
        preEventCtx.push("NEW EVENT: " + newEvent.type + " — " + newEvent.description);
      }
      const mechanicalEvents = [...preEventCtx, ...preCascadeCtx];

      // Build GameContext (captured by tool closures)
      const choiceBuffer: Array<{
        title: string;
        choices: { label: string; description: string }[];
      }> = [];
      const gameCtx = {
        state,
        station: stationObj,
        build,
        onChoices: (choiceSet: {
          title: string;
          choices: { label: string; description: string }[];
        }) => {
          choiceBuffer.push(choiceSet);
        },
        turnElapsedMinutes: 0,
        cascadeAdvancedMinutes: 0,
        isOpeningTurn: turnNumber === 1,
      };

      // Build tools, prompt, context
      const toolSets = createGameToolSets(state.characterClass, gameCtx);
      const systemPrompt = buildOrchestratorPrompt(stationObj, build);
      const turnContext = buildTurnContext(state, stationObj, mechanicalEvents.length > 0 ? mechanicalEvents : undefined);

      // Build message array
      const conversationHistory = (
        messagesDocs as Array<{ role: string; content: string }>
      ).map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));
      const messages = buildTurnMessages(conversationHistory, turnContext, playerInput);

      // ── Create AI text client ────────────────────────────────────────
      const aiClient = new OpenRouterAITextClient({
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
        referer: "https://github.com/station-omega",
        title: "Station Omega",
      });

      // ── Stream AI response ───────────────────────────────────────────
      const segmentParser = new StreamingSegmentParser();
      let rawJson = "";
      let segmentIndex = turnNumber > 1 ? 1 : 0;

      // Reserve the final step for structured JSON output by disabling tools.
      // Steps 0–10: tools available; step 11: toolChoice 'none' forces JSON.
      const MAX_TOOL_STEPS = 11;

      console.time("[processAITurn] AI streaming");
      const result = aiClient.streamStructuredObject({
        modelId: args.modelId ?? GAME_MASTER_MODEL_ID,
        system: systemPrompt,
        messages,
        tools: toolSets.all,
        schema: GameResponseSchema,
        temperature: 0.8,
        maxOutputTokens: 8192,
        stopAfterSteps: MAX_TOOL_STEPS + 1,
        disableToolsAfterStep: MAX_TOOL_STEPS,
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta" && typeof part.text === "string") {
          rawJson += part.text;

          // Extract complete segments and save reactively
          const newSegments = segmentParser.push(part.text);

          for (const seg of newSegments) {
            if (typeof seg.text !== "string" || !seg.text) continue;

            // Phase 5a: drop segments with unknown types
            if (!isValidSegmentType(seg.type)) {
              console.warn("[processAITurn] Dropping segment with unknown type:", seg.type);
              continue;
            }

            // Phase 5b: downgrade dialogue to narration on non-social turns
            if (shouldDowngradeDialogue(seg.type, playerInput)) {
              (seg as Record<string, unknown>).type = "narration";
              (seg as Record<string, unknown>).npcId = null;
              console.debug("[processAITurn] Downgraded dialogue to narration for non-social turn");
            }

            await ctx.runMutation(internal.turnSegments.save, {
              gameId,
              turnNumber,
              segmentIndex,
              segment: {
                type: seg.type,
                text: seg.text,
                npcId: seg.npcId,
                crewName: seg.crewName,
              },
            });
            segmentIndex++;
          }
        }
        // Tool calls/results handled internally (tools mutate gameCtx)
      }
      console.timeEnd("[processAITurn] AI streaming");
      console.debug("[processAITurn] Segments extracted", {
        segmentCount: segmentIndex - (turnNumber > 1 ? 1 : 0),
        rawJsonLength: rawJson.length,
      });

      // ── Post-turn: apply event damage for action-elapsed time ──
      if (gameCtx.turnElapsedMinutes > 0) {
        const postEventCtx = tracker.tickActiveEvents(state, gameCtx.turnElapsedMinutes);
        const postCascadeCtx = tracker.processCascadeEffects(state, stationObj, gameCtx.turnElapsedMinutes);
        void postEventCtx;
        void postCascadeCtx;
      }

      // ── Persist state after successful stream ────────────────────────
      state.eventCooldowns = Object.fromEntries(tracker.lastTriggered);
      state.turnCount = turnNumber;
      state.missionElapsedMinutes += gameCtx.turnElapsedMinutes;

      const serializedState = serializeGameState(state);

      // Persist NPC overrides
      const npcOverrides: Record<string, Record<string, unknown>> = {};
      for (const [npcId, npc] of stationObj.npcs) {
        npcOverrides[npcId] = {
          disposition: npc.disposition,
          isAlly: npc.isAlly,
          roomId: npc.roomId,
          memory: npc.memory,
        };
      }

      await ctx.runMutation(internal.games.updateAfterTurn, {
        gameId,
        state: serializedState,
        npcOverrides,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        roomOverrides: game.roomOverrides ?? {},
        isOver: state.gameOver,
        won: state.won,
        turnCount: turnNumber,
      });

      // Save messages
      await ctx.runMutation(internal.messages.appendBatch, {
        gameId,
        messages: buildTurnMessages([], turnContext, playerInput).concat({
          role: "assistant",
          content: rawJson,
        }),
      });

      // Save choices if any
      if (choiceBuffer.length > 0) {
        const lastChoices = choiceBuffer[choiceBuffer.length - 1];
        await ctx.runMutation(internal.choiceSets.save, {
          gameId,
          turnNumber,
          choices: mapChoicesForPersistence(lastChoices),
        });
      }

      // Mark turn as complete
      await ctx.runMutation(internal.turnLocks.release, { gameId });
      console.info("[processAITurn] Turn complete", { gameId, turnNumber, segmentCount: segmentIndex });
    } catch (err) {
      // Release lock on error
      await ctx.runMutation(internal.turnLocks.release, { gameId });

      // Save error as a diagnostic segment so the client sees it
      const message =
        err instanceof Error ? err.message : "Unknown error during turn";
      console.error("[processAITurn] AI error", { gameId, turnNumber, error: message });
      await ctx.runMutation(internal.turnSegments.save, {
        gameId,
        turnNumber,
        segmentIndex: 999,
        segment: {
          type: "diagnostic_readout",
          text: `**System Error:** ${message}`,
          npcId: null,
          crewName: null,
        },
      });
    }

    return null;
  },
});
