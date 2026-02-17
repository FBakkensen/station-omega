import { streamText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { appendFileSync } from 'node:fs';
import { GameUI } from './tui.js';
import type { CharacterClassId, GameState, GeneratedStation, SlashCommandDef, GameStatus, NPC, Room, ObjectiveChain, EventType } from './src/types.js';
import { generateStation } from './src/generation/index.js';
import { assembleStation } from './src/assembly.js';
import { creativeModel, anthropicDirect } from './src/models.js';
import { CHARACTER_BUILDS, getBuild, initializePlayerState } from './src/character.js';
import { createGameToolSets } from './src/tools.js';
import type { GameContext, ChoiceSet } from './src/tools.js';
import { buildOrchestratorPrompt } from './src/prompt.js';
import { createGameMasterConfig } from './src/agents.js';
import { EventTracker, advanceCascadeCountdowns } from './src/events.js';
import { EnvironmentTracker } from './src/environment.js';
import { buildTurnContext } from './src/turn-context.js';
import { validateGameResponse, buildGuardrailFeedback, validateStateConsistency } from './src/validation.js';
import { computeScore, saveRunToHistory, loadRunHistory } from './src/scoring.js';
import { TTSEngine } from './src/tts.js';
import { hasOpenRouterKey, setOpenRouterKey } from './src/env.js';
import { listSavedStations, saveStation, loadStation, deleteStation } from './src/station-storage.js';
import { GameResponseSchema } from './src/schema.js';
import type { DisplaySegment, GameResponse } from './src/schema.js';
import { StreamingSegmentParser } from './src/json-stream-parser.js';
import { segmentToStyledChunks, countChunkChars, getHeaderCharCount } from './src/segment-style.js';
import { renderMapStyled } from './src/map-render.js';

// ─── Turn Snapshot (for rollback on error) ──────────────────────────────────

interface TurnSnapshot {
    state: GameState;
    npcs: Map<string, NPC>;
    rooms: Map<string, Room>;
    objectives: ObjectiveChain;
    eventLastTriggered: Map<EventType, number>;
    conversationHistoryLength: number;
    pendingChoices: ChoiceSet | null;
}

// ─── Debug Log ──────────────────────────────────────────────────────────────

const DEBUG_LOG_PATH = 'debug.log';

function initDebugLog(): void {
    appendFileSync(DEBUG_LOG_PATH,
        `\n${'═'.repeat(60)}\n=== Station Omega Session — ${new Date().toISOString()} ===\n${'═'.repeat(60)}\n\n`);
}

function debugLog(label: string, content: string): void {
    const timestamp = new Date().toISOString();
    appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] [${label}]\n${content}\n${'─'.repeat(60)}\n\n`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStatus(state: GameState, station: GeneratedStation, envTracker?: EnvironmentTracker): GameStatus {
    const room = station.rooms.get(state.currentRoom);
    const roomKeys = [...station.rooms.keys()];

    // Update environment readings if tracker is provided
    let environment = envTracker?.current() ?? null;
    if (envTracker && room) {
        environment = envTracker.update(room, state.activeEvents);
    }

    return {
        hp: state.hp,
        maxHp: state.maxHp,
        roomName: room?.name ?? state.currentRoom,
        roomIndex: roomKeys.indexOf(state.currentRoom) + 1,
        totalRooms: station.rooms.size,
        inventory: state.inventory.map(id => station.items.get(id)?.name ?? id),
        inventoryKeyFlags: state.inventory.map(id => station.items.get(id)?.isKeyItem ?? false),
        characterClass: state.characterClass,
        turnCount: state.turnCount,
        maxInventory: state.maxInventory,
        oxygen: state.oxygen,
        maxOxygen: state.maxOxygen,
        suitIntegrity: state.suitIntegrity,
        activeEvents: state.activeEvents.map(e => ({ type: e.type, minutesRemaining: e.minutesRemaining, effect: e.effect })),
        objectiveTitle: station.objectives.title,
        objectiveStep: station.objectives.currentStepIndex,
        objectiveTotal: station.objectives.steps.length,
        objectiveCurrentDesc: station.objectives.steps[station.objectives.currentStepIndex]?.description ?? '',
        objectivesComplete: station.objectives.completed,
        objectiveSteps: station.objectives.steps.map(s => ({
            description: s.description,
            completed: s.completed,
        })),
        systemFailures: (room?.systemFailures ?? []).map(f => ({
            systemId: f.systemId,
            status: f.status,
            challengeState: f.challengeState,
            severity: f.severity,
            minutesUntilCascade: f.minutesUntilCascade,
        })),
        mapText: renderMapStyled(
            station,
            { roomsVisited: state.roomsVisited, currentRoom: state.currentRoom, itemsTaken: state.itemsTaken },
            station.mapLayout,
        ),
        environment,
        missionElapsedMinutes: state.missionElapsedMinutes,
    };
}

function getSlashCommands(state: GameState, station: GeneratedStation, ttsEngine: TTSEngine): SlashCommandDef[] {
    return [
        {
            name: 'map',
            description: 'Open the station map (visited areas)',
            needsTarget: false,
            getTargets: () => [],
            toPrompt: () => '/map',
        },
        {
            name: 'mission',
            description: 'Open mission objectives',
            needsTarget: false,
            getTargets: () => [],
            toPrompt: () => '/mission',
        },
        {
            name: 'look',
            description: 'Examine the room',
            needsTarget: false,
            getTargets: () => [],
            toPrompt: () => 'look around',
        },
        {
            name: 'move',
            description: 'Move to adjacent room',
            needsTarget: true,
            getTargets: () => {
                const room = station.rooms.get(state.currentRoom);
                if (!room) return [];
                return room.connections.map(id => {
                    const r = station.rooms.get(id);
                    return { label: r?.name ?? id, value: r?.name ?? id };
                });
            },
            toPrompt: (t) => t ? `move to ${t}` : 'move',
        },
        {
            name: 'pickup',
            description: 'Pick up an item',
            needsTarget: true,
            getTargets: () => {
                const items: { label: string; value: string }[] = [];
                const room = station.rooms.get(state.currentRoom);
                if (!room) return items;
                for (const lootId of room.loot) {
                    if (!state.itemsTaken.has(lootId)) {
                        const name = station.items.get(lootId)?.name ?? lootId;
                        items.push({ label: name, value: name });
                    }
                }
                return items;
            },
            toPrompt: (t) => t ? `pick up ${t}` : 'pick up',
        },
        {
            name: 'use',
            description: 'Use an inventory item',
            needsTarget: true,
            getTargets: () =>
                state.inventory.map(id => {
                    const name = station.items.get(id)?.name ?? id;
                    return { label: name, value: name };
                }),
            toPrompt: (t) => t ? `use ${t}` : 'use item',
        },
        {
            name: 'interact',
            description: 'Interact with an NPC',
            needsTarget: true,
            getTargets: () => {
                return [...station.npcs.values()]
                    .filter(n => n.roomId === state.currentRoom)
                    .map(n => ({ label: n.name, value: n.name }));
            },
            toPrompt: (t) => t ? `I want to interact with ${t}. Show me my options.` : 'interact with someone',
        },
        {
            name: 'attempt',
            description: 'Attempt a creative action',
            needsTarget: false,
            getTargets: () => [],
            toPrompt: () => 'What can I do here? Show me my options.',
        },
        {
            name: 'voice',
            description: ttsEngine.hasApiKey()
                ? (ttsEngine.isAudioEnabled() ? 'Disable voice narration' : 'Enable voice narration')
                : 'Set up voice narration',
            needsTarget: false,
            getTargets: () => [],
            toPrompt: () => '/voice',
        },
    ];
}

// ─── Segment Resolution ─────────────────────────────────────────────────────

/** Enrich a GameSegment with display metadata (speaker name, index). */
function resolveSegment(
    seg: { type: string; text: string; npcId: string | null; crewName: string | null },
    segmentIndex: number,
    station: GeneratedStation,
    missionElapsedMinutes?: number,
): DisplaySegment {
    let speakerName: string | null = null;
    if (seg.type === 'dialogue' && seg.npcId) {
        let npc = station.npcs.get(seg.npcId);
        if (!npc) {
            for (const n of station.npcs.values()) {
                if (n.name === seg.npcId) { npc = n; break; }
            }
        }
        speakerName = npc?.name ?? seg.npcId;
    } else if (seg.type === 'crew_echo') {
        speakerName = seg.crewName ?? 'Unknown';
    }

    // Set mission time on thought segments
    let missionTime: string | undefined;
    if (seg.type === 'thought' && missionElapsedMinutes !== undefined) {
        const h = Math.floor(missionElapsedMinutes / 60);
        const m = missionElapsedMinutes % 60;
        missionTime = `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    return { ...seg, type: seg.type as DisplaySegment['type'], speakerName, segmentIndex, missionTime };
}

// ─── Run Gameplay ───────────────────────────────────────────────────────────

async function runGameplay(
    ui: GameUI,
    station: GeneratedStation,
    classId: CharacterClassId,
    ttsEngine: TTSEngine,
): Promise<void> {
    const build = getBuild(classId);
    const runId = `run_${String(Date.now())}`;
    const state = initializePlayerState(classId, station.entryRoomId, runId, station.config.storyArc, station.config.difficulty);

    // Add starting items to station.items if not already there
    for (const itemId of state.inventory) {
        if (!station.items.has(itemId)) {
            const { STARTING_ITEMS } = await import('./src/data.js');
            const skItem = STARTING_ITEMS.get(itemId);
            if (skItem) {
                station.items.set(itemId, {
                    id: itemId,
                    name: itemId.replace(/_/g, ' '),
                    description: skItem.effect.description,
                    category: skItem.category,
                    effect: { ...skItem.effect },
                    isKeyItem: false,
                    useNarration: `You use the ${itemId.replace(/_/g, ' ')}.`,
                });
            }
        }
    }

    // Pending choices state
    let pendingChoices: ChoiceSet | null = null;

    // Event tracker
    const eventTracker = new EventTracker();

    // Environment tracker (passive sensor readings for sidebar)
    const envTracker = new EnvironmentTracker();

    // Configure TTS for this run
    ttsEngine.setNPCs(station.npcs);
    ttsEngine.setCrewRoster(station.crewRoster);

    // Game context (captured by tools via closure)
    const gameCtx: GameContext = {
        state,
        station,
        build,
        onChoices: (cs) => { pendingChoices = cs; },
        turnElapsedMinutes: 0,
        cascadeAdvancedMinutes: 0,
    };

    const toolSets = createGameToolSets(classId, gameCtx);

    // Wire TTS reveal callback — syncs text display with audio playback
    ttsEngine.onRevealChunk = (segmentIndex, charBudget, durationSec) => {
        debugLog('TTS-REVEAL-CB', `seg[${String(segmentIndex)}] charBudget=${String(charBudget)}, duration=${durationSec.toFixed(2)}s`);
        ui.revealChunk(segmentIndex, charBudget, durationSec);
    };

    initDebugLog();
    debugLog('SYSTEM', buildOrchestratorPrompt(station, build));
    ui.setDebugLog(debugLog);

    // Create game master config (model, system prompt, tools)
    const gmConfig = createGameMasterConfig(station, build, toolSets);

    // Client-side conversation history
    const conversationHistory: ModelMessage[] = [];

    let turnId = 0;

    /** Advance time after AI run completes. Tools accumulate elapsed minutes in gameCtx.turnElapsedMinutes. */
    function tickTime(): void {
        const elapsed = Math.max(1, gameCtx.turnElapsedMinutes);
        state.missionElapsedMinutes += elapsed;
        state.metrics.missionElapsedMinutes = state.missionElapsedMinutes;
        state.turnCount++;
        state.metrics.turnCount++;

        // Advance cascade countdown for any remaining time not yet applied during tools
        const remainingCascade = elapsed - gameCtx.cascadeAdvancedMinutes;
        if (remainingCascade > 0) {
            advanceCascadeCountdowns(station, remainingCascade);
        }

        // Tick active events with proportional damage
        const eventContext = eventTracker.tickActiveEvents(state, elapsed);

        // Check for new random event
        const newEvent = eventTracker.checkRandomEvent(state);
        if (newEvent) {
            state.activeEvents.push(newEvent);
            eventContext.push(`NEW EVENT: ${newEvent.type.replace(/_/g, ' ').toUpperCase()} — ${newEvent.effect}`);
        }

        // Process cascade effects (hazard damage, triggers, propagation — countdown already applied)
        const cascadeContext = eventTracker.processCascadeEffects(state, station, elapsed);
        eventContext.push(...cascadeContext);

        // Log event context for debugging
        if (eventContext.length > 0) {
            debugLog('EVENTS', `[${String(elapsed)} min elapsed]\n${eventContext.join('\n')}`);
        }
    }

    function createSnapshot(): TurnSnapshot {
        return {
            state: structuredClone(state),
            npcs: structuredClone(station.npcs),
            rooms: structuredClone(station.rooms),
            objectives: structuredClone(station.objectives),
            eventLastTriggered: structuredClone(eventTracker.lastTriggered),
            conversationHistoryLength: conversationHistory.length,
            pendingChoices: pendingChoices ? structuredClone(pendingChoices) : null,
        };
    }

    function restoreSnapshot(snapshot: TurnSnapshot): void {
        // GameState: copy all fields onto the live state object
        Object.assign(state, snapshot.state);

        // Station NPCs: replace Map contents
        station.npcs.clear();
        for (const [id, npc] of snapshot.npcs) station.npcs.set(id, npc);

        // Station Rooms: replace Map contents
        station.rooms.clear();
        for (const [id, room] of snapshot.rooms) station.rooms.set(id, room);

        // Objectives: mutate in place (reference used by tools)
        station.objectives.currentStepIndex = snapshot.objectives.currentStepIndex;
        station.objectives.completed = snapshot.objectives.completed;
        station.objectives.steps = snapshot.objectives.steps;

        // Event tracker cooldowns
        eventTracker.lastTriggered = snapshot.eventLastTriggered;

        // Conversation history: truncate to snapshot length
        conversationHistory.length = snapshot.conversationHistoryLength;

        // Turn-level variables
        pendingChoices = snapshot.pendingChoices;
    }

    async function sendPrompt(prompt: string): Promise<void> {
        const snapshot = createSnapshot();

        try {
            let guardrailFeedback: string | null = null;

            for (let attempt = 0; attempt <= 1; attempt++) {
                // On retry: restore snapshot, discard rendered UI, stop TTS
                if (attempt > 0) {
                    restoreSnapshot(snapshot);
                    ttsEngine.stop();
                    ui.discardTurnCards();
                }

                // Reset elapsed time accumulators — tools will add their durations during the AI run
                gameCtx.turnElapsedMinutes = 0;
                gameCtx.cascadeAdvancedMinutes = 0;

                // Build per-turn context as a system message (dynamic state the AI interprets)
                const turnContext = buildTurnContext(state, station);

                // Build messages for this turn
                const messages: ModelMessage[] = [
                    ...conversationHistory,
                    ...(guardrailFeedback ? [{ role: 'system' as const, content: guardrailFeedback }] : []),
                    ...(turnContext ? [{ role: 'system' as const, content: turnContext }] : []),
                    { role: 'user' as const, content: prompt },
                ];

                const turnAbort = new AbortController();
                const turnTimeout = setTimeout(() => { turnAbort.abort(); }, 120_000);

                const result = streamText({
                    model: gmConfig.model,
                    system: gmConfig.systemPrompt,
                    messages,
                    tools: gmConfig.tools,
                    temperature: 0.8,
                    maxOutputTokens: 8192,
                    stopWhen: stepCountIs(12),
                    abortSignal: turnAbort.signal,
                });

                // Process streaming events with JSON segment parser
                let rawJson = '';
                let streamStarted = false;
                let segmentsRendered = 0;
                const segmentParser = new StreamingSegmentParser();
                const toolOutcomes: { tool: string; status: 'ok' | 'error' | 'game_fail'; summary: string }[] = [];

                try {
                    for await (const part of result.fullStream) {
                        if (part.type === 'text-delta') {
                            rawJson += part.text;
                            if (!streamStarted) {
                                // Set narrator context for dynamic mood steering
                                const visitCount = state.roomVisitCount.get(state.currentRoom) ?? 0;
                                ttsEngine.setNarratorContext({
                                    hpPercent: (state.hp / state.maxHp) * 100,
                                    isNewRoom: visitCount <= 1,
                                });
                                ttsEngine.beginStream();
                                streamStarted = true;
                            }
                            // Extract complete segments from incremental JSON
                            const segments = segmentParser.push(part.text);
                            for (const seg of segments) {
                                const display = resolveSegment(seg, segmentsRendered, station, state.missionElapsedMinutes);
                                const chunks = segmentToStyledChunks(display);
                                const headerChars = getHeaderCharCount(display);
                                const bodyChars = countChunkChars(chunks) - headerChars;
                                ui.pushSegmentCard(display, chunks, headerChars);
                                ttsEngine.pushSegment(seg, bodyChars);
                                segmentsRendered++;
                                debugLog('SEGMENT', `[${seg.type}] ${seg.text.slice(0, 80)}...`);
                            }
                        } else if (part.type === 'tool-call') {
                            debugLog('TOOL-CALL', `${part.toolName}(${JSON.stringify(part.input).slice(0, 200)})`);
                        } else if (part.type === 'tool-result') {
                            const raw = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
                            debugLog('TOOL-RESULT', `${part.toolName}: ${raw.slice(0, 200)}`);
                            let status: 'ok' | 'error' | 'game_fail' = 'ok';
                            let summary = '';
                            try {
                                const parsed: unknown = JSON.parse(raw);
                                if (typeof parsed === 'object' && parsed !== null) {
                                    const obj = parsed as Record<string, unknown>;
                                    if (typeof obj['error'] === 'string') {
                                        status = 'error';
                                        summary = obj['error'];
                                    } else if (obj['success'] === false) {
                                        status = 'game_fail';
                                        summary = typeof obj['reason'] === 'string' ? obj['reason'] : 'failed';
                                    }
                                }
                            } catch { /* non-JSON tool result — treat as ok */ }
                            toolOutcomes.push({ tool: part.toolName, status, summary });
                        } else if (part.type === 'error') {
                            debugLog('STREAM-ERROR', String(part.error));
                        } else if (part.type === 'finish') {
                            debugLog('STREAM-FINISH', `reason=${part.finishReason}`);
                        }
                    }

                    // Fallback: if streaming yielded no segments, try full parse of rawJson
                    if (rawJson && segmentsRendered === 0) {
                        debugLog('WARN', 'No segments extracted during stream — fallback parse');
                        try {
                            const parsed = JSON.parse(rawJson) as GameResponse;
                            for (const seg of parsed.segments) {
                                const display = resolveSegment(seg, segmentsRendered, station, state.missionElapsedMinutes);
                                const chunks = segmentToStyledChunks(display);
                                const headerChars = getHeaderCharCount(display);
                                const bodyChars = countChunkChars(chunks) - headerChars;
                                ui.pushSegmentCard(display, chunks, headerChars);
                                ttsEngine.pushSegment(seg, bodyChars);
                                segmentsRendered++;
                            }
                        } catch {
                            // Strip JSON scaffolding and show whatever text we got
                            const textMatches = rawJson.match(/"text"\s*:\s*"([^"]+)"/gu);
                            if (textMatches) {
                                const fallbackText = textMatches
                                    .map(m => m.replace(/"text"\s*:\s*"/u, '').replace(/"$/u, ''))
                                    .join('\n\n');
                                ui.appendNarrative(fallbackText);
                            }
                            debugLog('WARN', `Fallback parse failed. Raw: ${rawJson.slice(0, 200)}`);
                        }
                    }

                    clearTimeout(turnTimeout);

                    // Advance time based on accumulated tool durations (after AI run)
                    tickTime();

                    // Guardrail validation: parse rawJson and validate
                    if (rawJson) {
                        try {
                            const parsed = GameResponseSchema.parse(JSON.parse(rawJson));
                            const issues = validateGameResponse(parsed, state, station);
                            const toolErrors = toolOutcomes.filter(t => t.status === 'error');
                            const hasProblems = issues.length > 0 || toolErrors.length > 0;

                            if (hasProblems && attempt === 0) {
                                guardrailFeedback = buildGuardrailFeedback(
                                    issues, state, station,
                                    toolErrors.length > 0 ? toolErrors.map(e => ({ tool: e.tool, summary: e.summary })) : undefined,
                                );
                                const reasons = [
                                    ...issues,
                                    ...toolErrors.map(e => `tool error: ${e.tool} — ${e.summary}`),
                                ];
                                debugLog('GUARDRAIL-RETRY', `Attempt 1 failed: ${reasons.join('; ')} — retrying`);
                                continue;
                            }
                            if (hasProblems) {
                                const reasons = [
                                    ...issues,
                                    ...toolErrors.map(e => `tool error: ${e.tool} — ${e.summary}`),
                                ];
                                debugLog('GUARDRAIL-FINAL', `Retry also failed: ${reasons.join('; ')}`);
                            }
                        } catch {
                            debugLog('GUARDRAIL-SKIP', 'Could not parse response for validation');
                        }
                    }

                    // Post-turn state consistency check (catches tool bugs, out-of-bounds values)
                    const stateIssues = validateStateConsistency(state, station);
                    if (stateIssues.length > 0) {
                        const summary = stateIssues
                            .map(i => `${i.field}: ${i.problem}${i.fixed ? ' [auto-fixed]' : ' [WARNING]'}`)
                            .join('; ');
                        debugLog('STATE-CHECK', summary);
                    }

                    // Update conversation history with this turn
                    conversationHistory.push({ role: 'user', content: prompt });
                    conversationHistory.push({ role: 'assistant', content: rawJson || '{}' });

                    // Append ground-truth tool outcome digest to prevent narrative drift
                    if (toolOutcomes.length > 0) {
                        const digest = toolOutcomes
                            .map(t => {
                                if (t.status === 'ok') return `${t.tool}: OK`;
                                if (t.status === 'game_fail') return `${t.tool}: GAME_FAIL (${t.summary})`;
                                return `${t.tool}: ERROR (${t.summary})`;
                            })
                            .join('; ');
                        conversationHistory.push({
                            role: 'system' as const,
                            content: `[Tool outcomes: ${digest}]`,
                        });
                    }
                } catch (err: unknown) {
                    // Non-guardrail streaming error: re-throw to outer catch
                    throw err;
                }

                // Log the raw JSON response
                if (rawJson) {
                    debugLog('AI-RAW', rawJson);
                }

                // Post-stream finalization
                ui.updateStatus(getStatus(state, station, envTracker));

                const afterStream = () => {
                    debugLog('SESSION', 'afterStream — calling finalizeAllCards');
                    ui.finalizeAllCards();
                    if (pendingChoices) {
                        ui.showChoiceCards(pendingChoices.title, pendingChoices.choices);
                        pendingChoices = null;
                    }
                    if (state.gameOver) {
                        ui.showGameOver(state.won);
                    }
                };

                // Flush TTS pipeline and finalize UI
                const thisTurn = turnId;
                if (ttsEngine.isStreamActive()) {
                    debugLog('SESSION', 'Waiting for TTS flushStream...');
                    try {
                        await ttsEngine.flushStream();
                        if (turnId !== thisTurn) {
                            debugLog('SESSION', 'flushStream resolved but turn changed — skipping afterStream');
                            return;
                        }
                        debugLog('SESSION', 'flushStream resolved');
                        afterStream();
                    } catch (err: unknown) {
                        debugLog('SESSION', `TTS flushStream error: ${String(err)}`);
                        ttsEngine.stop();
                        ui.appendNarrative('*Voice system error — audio disabled for this response.*');
                        afterStream();
                    }
                } else {
                    debugLog('SESSION', 'TTS stream not active — skipping flush');
                    afterStream();
                }

                break; // success — exit retry loop
            }
        } catch (err: unknown) {
            debugLog('SESSION', `Turn failed, rolling back: ${String(err)}`);
            restoreSnapshot(snapshot);
            ttsEngine.stop();
            ui.discardTurnCards();
            ui.hideTypingIndicator();
            ui.updateStatus(getStatus(state, station, envTracker));
            ui.appendNarrative(
                '*Static crackles through the comms. The station systems are unresponsive. Try again.*'
            );
        }
    }

    // Update UI
    ui.setSlashCommands(getSlashCommands(state, station, ttsEngine));
    ui.updateStatus(getStatus(state, station, envTracker));

    // Show voice hint if no API key is set
    if (!ttsEngine.hasApiKey()) {
        ui.appendNarrative('*Type /voice to set up voice narration.*');
    }

    // Kick off the game
    const openingPrompt = `${station.arrivalScenario.openingLine} What do I see?`;
    debugLog('PLAYER', openingPrompt);
    debugLog('SESSION', 'Sending opening prompt...');
    ui.showTypingIndicator();
    try {
        await sendPrompt(openingPrompt);
        debugLog('SESSION', 'Opening prompt completed.');
    } catch (err: unknown) {
        debugLog('SESSION', `Opening prompt error: ${String(err)}`);
        ttsEngine.stop();
        ui.hideTypingIndicator();
        ui.finalizeAllCards();
        ui.appendNarrative('*The station systems flicker. Connection unstable. Try entering a command.*');
    }

    // Wire up player input
    let awaitingApiKey = false;
    await new Promise<void>((resolve) => {
        ui.onInput((input: string) => {
            // Handle API key entry (from /voice prompt)
            if (awaitingApiKey) {
                if (!input.trim() || input.toLowerCase() === '/cancel') {
                    awaitingApiKey = false;
                    ui.appendNarrative('*API key entry cancelled.*');
                    return;
                }
                if (input.startsWith('/')) {
                    ui.appendNarrative('*That looks like a command, not an API key. Enter your Inworld API key or /cancel:*');
                    return;
                }
                awaitingApiKey = false;
                void ttsEngine.setApiKey(input.trim()).then(() => {
                    ui.appendNarrative('*Voice narration enabled. API key saved — voice will be enabled automatically next time.*');
                    ui.setSlashCommands(getSlashCommands(state, station, ttsEngine));
                }).catch((err: unknown) => {
                    ui.appendNarrative(`*Voice setup failed: ${String(err)}*`);
                });
                return;
            }

            // Invalidate any pending flushStream callback from the previous turn
            turnId++;
            // Stop any playing TTS audio and flush buffered text when player types
            ttsEngine.stop();
            ui.finalizeAllCards();

            if (state.gameOver) {
                // After game over, any input continues to score screen
                resolve();
                return;
            }

            if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
                resolve();
                return;
            }

            // /voice command — key entry or toggle
            if (input.toLowerCase() === '/voice') {
                if (!ttsEngine.hasApiKey()) {
                    ui.appendNarrative('*Enter your Inworld API key to enable voice narration (or /cancel):*');
                    awaitingApiKey = true;
                } else {
                    const nowEnabled = !ttsEngine.isAudioEnabled();
                    ttsEngine.setAudioEnabled(nowEnabled, true);
                    ui.appendNarrative(nowEnabled ? '*Voice narration enabled.*' : '*Voice narration disabled.*');
                    ui.setSlashCommands(getSlashCommands(state, station, ttsEngine));
                }
                return;
            }

            debugLog('PLAYER', input);
            ui.appendPlayerCommand(input);
            ui.showTypingIndicator();
            sendPrompt(input).catch((err: unknown) => {
                debugLog('SESSION', `Unhandled sendPrompt error: ${String(err)}`);
            });
        });
    });

    // Finalize metrics
    state.metrics.endTime = Date.now();
    state.metrics.roomsVisited = new Set(state.roomsVisited);

    // Compute and save score
    const score = computeScore(state.metrics, station.rooms.size);
    saveRunToHistory(state.metrics, score);

    // Show run summary
    await ui.showRunSummary(score, state.metrics);

    // Stop any playing TTS
    ttsEngine.stop();
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main() {
    const ui = new GameUI();
    await ui.init();

    // Initialize TTS (Inworld TTS-1.5 Max API) — never crashes, degrades to silent typewriter
    const globalTTS = new TTSEngine({ debugLog });
    await globalTTS.init();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop exits via break
    while (true) {
        // TITLE screen
        const choice = await ui.showTitleScreen();
        if (choice === 'quit') {
            break;
        }

        if (choice === 'history') {
            const history = loadRunHistory();
            await ui.showRunHistory(history);
            continue;
        }

        if (choice === 'settings') {
            // Settings sub-loop
            let inSettings = true;
            while (inSettings) {
                const action = await ui.showSettingsScreen({
                    hasOpenRouterKey: hasOpenRouterKey(),
                    hasInworldKey: !!process.env['INWORLD_API_KEY'],
                    voiceReady: globalTTS.hasApiKey(),
                    voiceEnabled: globalTTS.isAudioEnabled(),
                });

                if (action === 'openrouter_key') {
                    const key = await ui.showApiKeyEntry({
                        title: 'OPENROUTER API KEY',
                        description: 'Enter your OpenRouter API key (required for the AI game master).',
                        placeholder: 'sk-or-...',
                    });
                    if (key) {
                        await setOpenRouterKey(key);
                        await ui.showBriefMessage('OpenRouter API key saved.');
                    }
                } else if (action === 'inworld_key') {
                    const key = await ui.showApiKeyEntry({
                        title: 'INWORLD API KEY',
                        description: 'Enter your Inworld API key to enable voice narration.',
                        placeholder: 'base64 credentials...',
                    });
                    if (key) {
                        try {
                            await globalTTS.setApiKey(key);
                            await ui.showBriefMessage('Voice narration enabled. API key saved.');
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            debugLog('SETTINGS', `Inworld key setup failed: ${msg}`);
                            await ui.showBriefMessage(`Voice setup failed: ${msg}`);
                        }
                    }
                } else if (action === 'voice_toggle') {
                    const nowEnabled = !globalTTS.isAudioEnabled();
                    globalTTS.setAudioEnabled(nowEnabled, true);
                } else {
                    inSettings = false;
                }
            }
            continue;
        }

        // NEW RUN - check for API key first
        if (!hasOpenRouterKey()) {
            const key = await ui.showApiKeyEntry({
                title: 'OPENROUTER API KEY',
                description: 'Enter your OpenRouter API key to start a new run.',
                placeholder: 'sk-or-...',
            });
            if (!key) {
                continue;
            }
            await setOpenRouterKey(key);
        }

        // STATION PICKER (with delete loop)
        let stationChoice: { type: 'new' } | { type: 'saved'; id: string } | null = null;
        let stationPickerDone = false;
        while (!stationPickerDone) {
            const savedStations = listSavedStations();
            const pick = await ui.showStationPicker(savedStations);
            if (!pick) {
                // ESC → back to title
                stationPickerDone = true;
                break;
            }
            // Handle delete: id prefixed with __delete__
            if (pick.type === 'saved' && pick.id.startsWith('__delete__')) {
                const deleteId = pick.id.slice('__delete__'.length);
                const meta = savedStations.find(s => s.id === deleteId);
                const name = meta?.stationName ?? 'station';
                await ui.showBriefMessage(`Deleted: ${name}`);
                deleteStation(deleteId);
                continue; // Re-show picker
            }
            stationChoice = pick;
            stationPickerDone = true;
        }
        if (!stationChoice) {
            continue; // ESC → back to title
        }

        // CHARACTER SELECT (always, regardless of new/saved)
        const classId = await ui.showCharacterSelect(CHARACTER_BUILDS);
        if (!classId) {
            continue;
        }

        let station: GeneratedStation;

        if (stationChoice.type === 'new') {
            // GENERATE NEW STATION
            ui.showGenerating();
            const { skeleton, creative } = await generateStation(
                { difficulty: 'normal', characterClass: classId, model: creativeModel, providerOptions: anthropicDirect },
                (message) => { ui.updateLoadingMessage(message); },
                debugLog,
            );
            station = assembleStation(skeleton, creative);
            saveStation(station); // Auto-save after generation
        } else {
            // LOAD SAVED STATION
            const loaded = loadStation(stationChoice.id);
            if (!loaded) {
                await ui.showBriefMessage('Failed to load station. File may be corrupt.');
                continue;
            }
            station = loaded;
            station.config.characterClass = classId; // Override class for replayability
        }

        // GAMEPLAY
        ui.showGameplayScreen();
        await runGameplay(ui, station, classId, globalTTS);
    }

    await globalTTS.cleanup();
    ui.destroy();
    process.exit(0);
}

main().catch((err: unknown) => {
    process.stderr.write(`Fatal error: ${String(err)}\n`);
    process.exit(1);
});
