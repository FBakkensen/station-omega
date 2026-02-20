"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

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
 * 4. Call streamText() with model, tools, messages
 * 5. As segments complete → write to turnSegments table (reactive)
 * 6. After completion → persist state + messages to Convex
 */
export const processAITurn = internalAction({
  args: {
    gameId: v.id("games"),
    playerInput: v.string(),
    turnNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { gameId, playerInput, turnNumber } = args;
    console.log("[processAITurn] Starting turn", turnNumber, "for game", gameId, "input:", playerInput);

    try {
      // ── Load game data from Convex ───────────────────────────────────
      console.log("[processAITurn] Loading game data...");
      const game = await ctx.runQuery(internal.games.getInternal, {
        id: gameId,
      });
      if (!game) throw new Error("Game not found");
      console.log("[processAITurn] Game loaded, stationId:", game.stationId);

      const station = await ctx.runQuery(internal.stations.getInternal, {
        id: game.stationId,
      });
      if (!station) throw new Error("Station not found");

      const messagesDocs = await ctx.runQuery(internal.messages.listInternal, {
        gameId,
      });

      // ── Dynamic imports (ESM from src/) ──────────────────────────────
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const { streamText, Output, stepCountIs } = await import("ai");
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
      };

      // Build tools, prompt, context
      const toolSets = createGameToolSets(state.characterClass, gameCtx);
      const systemPrompt = buildOrchestratorPrompt(stationObj, build);
      const turnContext = buildTurnContext(state, stationObj);

      // Build message array
      const conversationHistory = (
        messagesDocs as Array<{ role: string; content: string }>
      ).map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));
      const messages = [
        ...conversationHistory,
        ...(turnContext
          ? [{ role: "system" as const, content: turnContext }]
          : []),
        { role: "user" as const, content: playerInput },
      ];

      // ── Create OpenRouter model ──────────────────────────────────────
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
        headers: {
          "HTTP-Referer": "https://github.com/station-omega",
          "X-Title": "Station Omega",
        },
      });
      const model = openrouter("google/gemini-3-flash-preview");

      // ── Stream AI response ───────────────────────────────────────────
      const segmentParser = new StreamingSegmentParser();
      let rawJson = "";
      let segmentIndex = 0;

      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: toolSets.all,
        output: Output.object({ schema: GameResponseSchema }),
        temperature: 0.8,
        maxOutputTokens: 8192,
        stopWhen: stepCountIs(12),
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          rawJson += part.text;

          // Extract complete segments and save reactively
          const newSegments = segmentParser.push(part.text);
          for (const seg of newSegments) {
            if (typeof seg.text !== "string" || !seg.text) continue;

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

      // ── Persist state after successful stream ────────────────────────
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
        messages: [
          ...(turnContext
            ? [{ role: "system" as const, content: turnContext }]
            : []),
          { role: "user" as const, content: playerInput },
          { role: "assistant" as const, content: rawJson },
        ],
      });

      // Save choices if any
      if (choiceBuffer.length > 0) {
        const lastChoices = choiceBuffer[choiceBuffer.length - 1];
        await ctx.runMutation(internal.choiceSets.save, {
          gameId,
          turnNumber,
          choices: lastChoices.choices.map((c, i) => ({
            id: String(i),
            label: c.label,
            description: c.description,
          })),
        });
      }

      // Mark turn as complete
      await ctx.runMutation(internal.turnLocks.release, { gameId });
    } catch (err) {
      // Release lock on error
      await ctx.runMutation(internal.turnLocks.release, { gameId });

      // Save error as a diagnostic segment so the client sees it
      const message =
        err instanceof Error ? err.message : "Unknown error during turn";
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
