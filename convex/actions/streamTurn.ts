"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { buildTurnMessages, mapChoicesForPersistence, isValidSegmentType, shouldDowngradeDialogue } from "./streamTurn.helpers";
import { buildRoomImagePrompt, buildItemImagePrompt, CINEMATIC_SUFFIX } from "../../src/image-prompts.js";
import { EventTracker } from "../../src/events.js";
import type { EventType } from "../../src/types.js";
import type { ChoiceSet } from "../../src/tools.js";

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
    const turnStartMs = Date.now();
    let effectiveModelId = "unknown";
    let stationIdForLog: string | undefined;

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
      stationIdForLog = game.stationId;

      const messagesDocs = await ctx.runQuery(internal.messages.listInternal, {
        gameId,
      });

      // ── Dynamic imports (ESM from src/) ──────────────────────────────
      const { OpenRouterAITextClient } = await import("../../src/io/openrouter-ai-client.js");
      const { GAME_MASTER_MODEL_ID } = await import("../../src/models.js");
      const { isValidGameMasterModelId } = await import("../../src/model-catalog.js");
      const { createGameToolSets } = await import("../../src/tools.js");
      const { normalizeObjectiveChainWithLegacySupport } = await import("../../src/objectives.js");
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
      normalizeObjectiveChainWithLegacySupport(stationObj.objectives);

      // Snapshot step completion states for objective video detection
      const previousStepCompletions = stationObj.objectives.steps.map(s => s.completed);

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
      const choiceBuffer: ChoiceSet[] = [];
      const gameCtx = {
        state,
        station: stationObj,
        build,
        onChoices: (choiceSet: ChoiceSet) => {
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

      // Defense-in-depth: normalize invalid modelId to default
      effectiveModelId = GAME_MASTER_MODEL_ID;
      if (args.modelId) {
        if (isValidGameMasterModelId(args.modelId)) {
          effectiveModelId = args.modelId;
        } else {
          console.warn("[processAITurn] Invalid modelId rejected, using default", { modelId: args.modelId });
        }
      }

      // Track room before AI execution for image generation triggers
      const previousRoom = state.currentRoom;
      const seenItemIds = new Set<string>();

      console.time("[processAITurn] AI streaming");
      const result = aiClient.streamStructuredObject({
        modelId: effectiveModelId,
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

            // Track item IDs from entity refs for image generation
            if (seg.entityRefs) {
              for (const ref of seg.entityRefs) {
                if (ref.type === 'item' && ref.id) {
                  seenItemIds.add(ref.id);
                }
              }
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
                ...(seg.entityRefs
                  ? { entityRefs: seg.entityRefs.slice(0, 3) }
                  : {}),
              },
            });
            segmentIndex++;
          }
        }
        // Tool calls/results handled internally (tools mutate gameCtx)
      }
      const parsedOutput = await result.output;
      const usage = await result.usage;
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

      await ctx.runMutation(internal.games.updateAfterTurn, {
        gameId,
        state: serializedState,
        objectivesOverride: stationObj.objectives,
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

      // ── Log AI call ─────────────────────────────────────────────────
      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "openrouter" as const,
          operation: "game_turn" as const,
          gameId,
          stationId: game.stationId,
          turnNumber,
          modelId: effectiveModelId,
          prompt: systemPrompt + "\n\n" + messages.map((m) => `[${m.role}] ${m.content}`).join("\n"),
          response: rawJson,
          status: "success" as const,
          durationMs: Date.now() - turnStartMs,
          metadata: {
            segmentCount: segmentIndex - (turnNumber > 1 ? 1 : 0),
            rawJsonLength: rawJson.length,
            playerInput,
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
            costUsd: usage.costUsd,
          },
        });
      } catch (logErr) {
        console.warn("[processAITurn] Failed to write AI log", logErr);
      }

      // Save choices if any
      if (choiceBuffer.length > 0) {
        const lastChoices = choiceBuffer[choiceBuffer.length - 1];
        await ctx.runMutation(internal.choiceSets.save, {
          gameId,
          turnNumber,
          title: lastChoices.title,
          choices: mapChoicesForPersistence(lastChoices),
        });
      }

      // ── Schedule image generation (fire-and-forget, all independent) ──
      const imageSchedules: Array<Promise<unknown>> = [];

      const roomChanged = state.currentRoom !== previousRoom || turnNumber === 1;
      if (roomChanged) {
        const room = stationObj.rooms.get(state.currentRoom);
        if (room) {
          const cacheKey = `room:${state.currentRoom}`;
          const aiImagePrompt = typeof parsedOutput.imagePrompt === 'string'
            ? parsedOutput.imagePrompt + ' ' + (stationObj.visualStyleGuide ?? '') + ' ' + CINEMATIC_SUFFIX
            : null;
          const prompt = aiImagePrompt || buildRoomImagePrompt(room, stationObj, state.activeEvents);

          console.info("[processAITurn] Image prompt", {
            source: aiImagePrompt ? "ai" : "fallback",
            aiRaw: parsedOutput.imagePrompt,
            promptLength: prompt.split(/\s+/).length,
            prompt: prompt.slice(0, 200),
          });

          imageSchedules.push(ctx.scheduler.runAfter(0, internal.actions.generateImage.generate, {
            stationId: game.stationId,
            gameId,
            cacheKey,
            category: "room_scene" as const,
            prompt,
          }));
        }
      }

      // Items — independent, room-agnostic atmospheric prompts
      for (const itemId of seenItemIds) {
        const item = stationObj.items.get(itemId);
        if (item) {
          imageSchedules.push(ctx.scheduler.runAfter(0, internal.actions.generateImage.generate, {
            stationId: game.stationId,
            gameId,
            cacheKey: `item:${itemId}`,
            category: "item_image" as const,
            prompt: buildItemImagePrompt(item),
          }));
        }
      }

      // ── Schedule objective completion video (image-to-video) ──────
      const objectiveVideoPrompt = typeof parsedOutput.objectiveVideoPrompt === 'string'
        ? parsedOutput.objectiveVideoPrompt : null;

      if (objectiveVideoPrompt) {
        const newlyCompleted = stationObj.objectives.steps.filter(
          (step, i) => step.completed && !previousStepCompletions[i]
        );
        if (newlyCompleted.length > 0) {
          const step = newlyCompleted[0];
          const cacheKey = `objective_video:${step.id}`;
          const sourceCacheKey = step.requiredItemId
            ? `item:${step.requiredItemId}`
            : `room:${state.currentRoom}`;

          const sourceImage = await ctx.runQuery(internal.stationImages.getByCacheKey, {
            stationId: game.stationId,
            gameId,
            cacheKey: sourceCacheKey,
          });
          const sourceImageUrl = sourceImage?.storageId
            ? await ctx.storage.getUrl(sourceImage.storageId) : undefined;

          imageSchedules.push(ctx.scheduler.runAfter(0, internal.actions.generateVideo.generate, {
            stationId: game.stationId,
            gameId,
            cacheKey,
            category: "objective_video" as const,
            prompt: objectiveVideoPrompt,
            ...(sourceImageUrl ? { imageUrl: sourceImageUrl } : {}),
          }));
        }
      }

      await Promise.all(imageSchedules);

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
      try {
        await ctx.runMutation(internal.aiLogs.log, {
          provider: "openrouter" as const,
          operation: "game_turn" as const,
          gameId,
          stationId: stationIdForLog as Id<"stations"> | undefined,
          turnNumber,
          modelId: effectiveModelId,
          status: "error" as const,
          error: message,
          durationMs: Date.now() - turnStartMs,
        });
      } catch { /* logging must not mask the real error */ }
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
