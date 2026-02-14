import { run, system, user, OutputGuardrailTripwireTriggered } from '@openai/agents';
import type { OutputGuardrail, RunStreamEvent } from '@openai/agents';
import { appendFileSync, writeFileSync } from 'node:fs';
import { GameUI } from './tui.js';
import type { CharacterClassId, GameState, GeneratedStation, SlashCommandDef, GameStatus, StoryArc, NPC, Room, ObjectiveChain, EventType } from './src/types.js';
import { generateSkeleton } from './src/skeleton.js';
import { generateCreativeContent } from './src/creative.js';
import { assembleStation } from './src/assembly.js';
import { CHARACTER_BUILDS, getBuild, initializePlayerState } from './src/character.js';
import { createGameToolSets } from './src/tools.js';
import type { GameContext, ChoiceSet } from './src/tools.js';
import { buildOrchestratorPrompt } from './src/prompt.js';
import { createAgents } from './src/agents.js';
import { EventTracker, getEventContext } from './src/events.js';
import { computeEnvironment, EnvironmentTracker } from './src/environment.js';
import { computeScore, saveRunToHistory, loadRunHistory } from './src/scoring.js';
import { TTSEngine } from './src/tts.js';
import { hasOpenAiKey, setOpenAiKey } from './src/env.js';
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
    lastResponseId: string | undefined;
    pendingChoices: ChoiceSet | null;
}

// ─── Debug Log ──────────────────────────────────────────────────────────────

const DEBUG_LOG_PATH = 'debug.log';

function initDebugLog(): void {
    writeFileSync(DEBUG_LOG_PATH, `=== Station Omega Debug Log — ${new Date().toISOString()} ===\n\n`);
}

function debugLog(label: string, content: string): void {
    const timestamp = new Date().toISOString();
    appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] [${label}]\n${content}\n${'─'.repeat(60)}\n\n`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STORY_ARCS: StoryArc[] = [
    'cascade_failure', 'atmosphere_breach', 'reactor_meltdown',
    'contamination_crisis', 'power_death_spiral', 'orbital_decay',
];

function randomStoryArc(): StoryArc {
    return STORY_ARCS[Math.floor(Math.random() * STORY_ARCS.length)];
}

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
            { roomsVisited: state.roomsVisited, currentRoom: state.currentRoom, roomLootTaken: state.roomLootTaken },
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
                if (room.loot && !state.roomLootTaken.has(state.currentRoom)) {
                    const name = station.items.get(room.loot)?.name ?? room.loot;
                    items.push({ label: name, value: name });
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

// ─── Turn Context ───────────────────────────────────────────────────────────

/** Build dynamic per-turn context as a system message. Returns null if no context needed. */
function buildTurnContext(state: GameState, station: GeneratedStation): string | null {
    const parts: string[] = [];

    // Mission elapsed time
    const hours = Math.floor(state.missionElapsedMinutes / 60);
    const mins = state.missionElapsedMinutes % 60;
    parts.push(`MISSION ELAPSED TIME: T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);

    // Active events
    if (state.activeEvents.length > 0) {
        parts.push(getEventContext(state.activeEvents));
    }

    // NPC state hints (raw data for AI to interpret)
    const roomNpcs = [...station.npcs.values()].filter(n => n.roomId === state.currentRoom);
    for (const npc of roomNpcs) {
        if (npc.isAlly) {
            parts.push(`ALLY: ${npc.name} is helping you.`);
        }
    }

    // Moral profile (raw scores — let the AI interpret)
    const { mercy, sacrifice, pragmatic } = state.moralProfile.tendencies;
    if (mercy + sacrifice + pragmatic > 0) {
        parts.push(`MORAL PROFILE: mercy=${String(mercy)}, sacrifice=${String(sacrifice)}, pragmatic=${String(pragmatic)}`);
    }

    // Player condition as raw ratio
    const hpPct = state.hp / state.maxHp;
    if (hpPct < 0.5) {
        parts.push(`PLAYER CONDITION: HP ${String(state.hp)}/${String(state.maxHp)} (${String(Math.round(hpPct * 100))}%)`);
    }

    // Oxygen and suit integrity
    if (state.oxygen < state.maxOxygen) {
        parts.push(`OXYGEN: ${String(state.oxygen)}/${String(state.maxOxygen)}`);
    }
    if (state.suitIntegrity < 100) {
        parts.push(`SUIT INTEGRITY: ${String(state.suitIntegrity)}%`);
    }

    // System failures in current room
    const currentRoom = station.rooms.get(state.currentRoom);
    if (currentRoom) {
        const activeFailures = currentRoom.systemFailures.filter(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');
        if (activeFailures.length > 0) {
            const failureLines = activeFailures.map(f =>
                `- ${f.systemId} [${f.status}/${f.challengeState}] mode=${f.failureMode} sev=${String(f.severity)} cascade=${String(Math.round(f.minutesUntilCascade))}min`
            );
            parts.push(`SYSTEM FAILURES:\n${failureLines.join('\n')}`);
        }

        // Environment readings (matches sidebar display values)
        const env = computeEnvironment(currentRoom, state.activeEvents);
        parts.push(
            `ENVIRONMENT: O₂ ${env.oxygenPct.toFixed(1)}% | CO₂ ${String(Math.round(env.co2Ppm))}ppm | ` +
            `Pressure ${env.pressureKpa.toFixed(1)}kPa | Temp ${String(Math.round(env.temperatureC))}°C | ` +
            `Rad ${env.radiationMsv.toFixed(1)}mSv | Structural ${String(Math.round(env.structuralPct))}%`
        );
    }

    return parts.join('\n\n');
}

// ─── Guardrail Feedback ─────────────────────────────────────────────────────

/** Build a corrective system message when the output guardrail trips. */
function buildGuardrailFeedback(
    issues: string[],
    state: GameState,
    station: GeneratedStation,
): string {
    const parts: string[] = [
        'PREVIOUS RESPONSE REJECTED — validation errors:',
        ...issues.map(i => `- ${i}`),
        '',
    ];

    // Valid NPCs in current room
    const roomNpcs = [...station.npcs.values()]
        .filter(n => n.roomId === state.currentRoom);
    if (roomNpcs.length > 0) {
        parts.push('Valid NPCs in current room (use the "id" value for npcId):');
        for (const npc of roomNpcs) {
            parts.push(`- id: "${npc.id}", name: "${npc.name}", disposition: ${npc.disposition}`);
        }
        parts.push('');
    }

    // Valid crew roster
    if (station.crewRoster.length > 0) {
        parts.push('Valid crew roster names (use exact name for crewName):');
        parts.push(`- ${station.crewRoster.map(c => c.name).join(', ')}`);
        parts.push('');
    }

    parts.push('Re-generate your response using only valid identifiers.');
    return parts.join('\n');
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

    // Game context (injected into tools and instructions via RunContext)
    const gameCtx: GameContext = {
        state,
        station,
        build,
        onChoices: (cs) => { pendingChoices = cs; },
        turnElapsedMinutes: 0,
    };

    const toolSets = createGameToolSets(classId);

    // Wire TTS reveal callback — syncs text display with audio playback
    ttsEngine.onRevealChunk = (segmentIndex, charBudget, durationSec) => {
        debugLog('TTS-REVEAL-CB', `seg[${String(segmentIndex)}] charBudget=${String(charBudget)}, duration=${durationSec.toFixed(2)}s`);
        ui.revealChunk(segmentIndex, charBudget, durationSec);
    };

    initDebugLog();
    debugLog('SYSTEM', buildOrchestratorPrompt(station, build));
    ui.setDebugLog(debugLog);

    // Output guardrail — validates AI output against game rules (no extra LLM call)
    const gameRulesGuardrail: OutputGuardrail<typeof GameResponseSchema> = {
        name: 'game-rules-check',
        execute: ({ agentOutput: response }) => {
            const issues: string[] = [];

            for (const seg of response.segments) {
                // Dialogue must reference a living NPC in the current room
                if (seg.type === 'dialogue' && seg.npcId) {
                    let npc = station.npcs.get(seg.npcId);
                    if (!npc) {
                        for (const n of station.npcs.values()) {
                            if (n.name === seg.npcId) { npc = n; break; }
                        }
                    }
                    if (!npc) issues.push(`Unknown NPC ID: ${seg.npcId}`);
                    else if (npc.roomId !== state.currentRoom) issues.push(`NPC not in room: ${seg.npcId}`);
                }
                // Crew echo must reference a roster member
                if (seg.type === 'crew_echo' && seg.crewName) {
                    const found = station.crewRoster.some(c => c.name === seg.crewName);
                    if (!found) issues.push(`Unknown crew name: ${seg.crewName}`);
                }
            }

            return Promise.resolve({
                tripwireTriggered: issues.length > 0,
                outputInfo: { issues },
            });
        },
    };

    // Create orchestrator + specialist agents with handoffs
    const { gameMaster } = createAgents(station, build, toolSets, gameRulesGuardrail);

    let lastResponseId: string | undefined;
    let turnId = 0;

    /** Advance time after AI run completes. Tools accumulate elapsed minutes in gameCtx.turnElapsedMinutes. */
    function tickTime(): void {
        const elapsed = Math.max(1, gameCtx.turnElapsedMinutes);
        state.missionElapsedMinutes += elapsed;
        state.metrics.missionElapsedMinutes = state.missionElapsedMinutes;
        state.turnCount++;
        state.metrics.turnCount++;

        // Tick active events with proportional damage
        const eventContext = eventTracker.tickActiveEvents(state, elapsed);

        // Check for new random event
        const newEvent = eventTracker.checkRandomEvent(state);
        if (newEvent) {
            state.activeEvents.push(newEvent);
            eventContext.push(`NEW EVENT: ${newEvent.type.replace(/_/g, ' ').toUpperCase()} — ${newEvent.effect}`);
        }

        // Tick cascade timers with proportional time
        const cascadeContext = eventTracker.tickCascadeTimers(state, station, elapsed);
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
            lastResponseId,
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

        // Turn-level variables
        lastResponseId = snapshot.lastResponseId;
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

                // Reset elapsed time accumulator — tools will add their durations during the AI run
                gameCtx.turnElapsedMinutes = 0;

                // Build per-turn context as a system message (dynamic state the AI interprets)
                const turnContext = buildTurnContext(state, station);
                const input = [
                    ...(guardrailFeedback ? [system(guardrailFeedback)] : []),
                    ...(turnContext ? [system(turnContext)] : []),
                    user(prompt),
                ];

                const stream = await run(gameMaster, input, {
                    stream: true,
                    context: gameCtx,
                    maxTurns: 12,
                    previousResponseId: lastResponseId,
                });

                // Process streaming events with JSON segment parser
                let rawJson = '';
                let streamStarted = false;
                let segmentsRendered = 0;
                const segmentParser = new StreamingSegmentParser();

                // Wrap stream + lastResponseId in a single try so guardrail
                // errors thrown during the for-await are caught for retry.
                try {
                    for await (const event of stream as AsyncIterable<RunStreamEvent>) {
                        // Log agent handoffs for debugging
                        if (event.type === 'agent_updated_stream_event') {
                            debugLog('HANDOFF', `Active agent: ${event.agent.name}`);
                        }
                        if (event.type === 'raw_model_stream_event') {
                            const data = event.data as { type: string; delta?: string };
                            if (data.type === 'output_text_delta' && data.delta) {
                                rawJson += data.delta;
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
                                const segments = segmentParser.push(data.delta);
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
                            }
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

                    // Capture response ID for conversation chaining
                    lastResponseId = stream.lastResponseId;

                    // Advance time based on accumulated tool durations (after AI run)
                    tickTime();
                } catch (err: unknown) {
                    if (err instanceof OutputGuardrailTripwireTriggered && attempt === 0) {
                        const issues = (err.result.output.outputInfo as { issues: string[] }).issues;
                        guardrailFeedback = buildGuardrailFeedback(issues, state, station);
                        debugLog('GUARDRAIL-RETRY', `Attempt 1 failed: ${issues.join('; ')} — retrying`);
                        continue;
                    }
                    // Attempt 2 failure or non-guardrail error: re-throw to outer catch
                    if (err instanceof OutputGuardrailTripwireTriggered) {
                        const issues = (err.result.output.outputInfo as { issues: string[] }).issues;
                        debugLog('GUARDRAIL-FINAL', `Retry also failed: ${issues.join('; ')}`);
                    }
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
                    hasOpenAiKey: hasOpenAiKey(),
                    hasInworldKey: !!process.env['INWORLD_API_KEY'],
                    voiceReady: globalTTS.hasApiKey(),
                    voiceEnabled: globalTTS.isAudioEnabled(),
                });

                if (action === 'openai_key') {
                    const key = await ui.showApiKeyEntry({
                        title: 'OPENAI API KEY',
                        description: 'Enter your OpenAI API key (required for the AI game master).',
                        placeholder: 'sk-...',
                    });
                    if (key) {
                        await setOpenAiKey(key);
                        await ui.showBriefMessage('OpenAI API key saved.');
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

        // CHARACTER SELECT
        const classId = await ui.showCharacterSelect(CHARACTER_BUILDS);

        // Guard: OpenAI key must be set before starting a run
        if (!hasOpenAiKey()) {
            await ui.showBriefMessage('OpenAI API key is required. Please configure it in Settings.');
            continue;
        }

        // GENERATING
        const seed = Math.floor(Math.random() * 2147483647);
        const arc = randomStoryArc();
        ui.showGenerating();

        const skeleton = generateSkeleton({ seed, difficulty: 'normal', storyArc: arc, characterClass: classId });
        const creative = await generateCreativeContent(skeleton, (message) => {
            ui.updateLoadingMessage(message);
        }, debugLog);
        const station = assembleStation(skeleton, creative);

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
