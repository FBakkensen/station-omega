import { CopilotClient } from '@github/copilot-sdk';
import { appendFileSync, writeFileSync } from 'node:fs';
import { GameUI } from './tui.js';
import type { CharacterClassId, GameState, GeneratedStation, SlashCommandDef, NPCDisplayInfo, GameStatus, StoryArc } from './src/types.js';
import { generateSkeleton } from './src/skeleton.js';
import { generateCreativeContent } from './src/creative.js';
import { assembleStation } from './src/assembly.js';
import { CHARACTER_BUILDS, getBuild, initializePlayerState } from './src/character.js';
import { createGameTools } from './src/tools.js';
import type { ToolContext, ChoiceSet } from './src/tools.js';
import { buildSystemPrompt } from './src/prompt.js';
import { EventTracker, getEventContext } from './src/events.js';
import { computeScore, saveRunToHistory, loadRunHistory } from './src/scoring.js';
import { TTSEngine } from './src/tts.js';

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
    'parasite_outbreak', 'ai_mutiny', 'dimensional_rift',
    'corporate_betrayal', 'time_anomaly', 'first_contact',
];

function randomStoryArc(): StoryArc {
    return STORY_ARCS[Math.floor(Math.random() * STORY_ARCS.length)];
}

function getNPCsInRoom(roomId: string, station: GeneratedStation): NPCDisplayInfo[] {
    return [...station.npcs.values()]
        .filter(npc => npc.roomId === roomId && npc.disposition !== 'dead')
        .map(npc => ({
            name: npc.name,
            disposition: npc.disposition,
            hpPct: npc.currentHp / npc.maxHp,
            currentHp: npc.currentHp,
            maxHp: npc.maxHp,
        }));
}

function getStatus(state: GameState, station: GeneratedStation): GameStatus {
    const room = station.rooms.get(state.currentRoom);
    const roomKeys = [...station.rooms.keys()];
    return {
        hp: state.hp,
        maxHp: state.maxHp,
        roomName: room?.name ?? state.currentRoom,
        roomIndex: roomKeys.indexOf(state.currentRoom) + 1,
        totalRooms: station.rooms.size,
        inventory: state.inventory.map(id => station.items.get(id)?.name ?? id),
        inventoryKeyFlags: state.inventory.map(id => station.items.get(id)?.isKeyItem ?? false),
        npcs: getNPCsInRoom(state.currentRoom, station),
        characterClass: state.characterClass,
        turnCount: state.turnCount,
        damage: state.damage,
        maxInventory: state.maxInventory,
        shieldActive: state.shieldActive,
        plasmaBoost: state.plasmaBoost,
        activeEvents: state.activeEvents.map(e => ({ type: e.type, turnsRemaining: e.turnsRemaining, effect: e.effect })),
        objectiveTitle: station.objectives.title,
        objectiveStep: station.objectives.currentStepIndex,
        objectiveTotal: station.objectives.steps.length,
        objectiveCurrentDesc: station.objectives.steps[station.objectives.currentStepIndex]?.description ?? '',
        objectivesComplete: station.objectives.completed,
        objectiveSteps: station.objectives.steps.map(s => ({
            description: s.description,
            completed: s.completed,
        })),
    };
}

function getSlashCommands(state: GameState, station: GeneratedStation, ttsEngine: TTSEngine): SlashCommandDef[] {
    return [
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
                const drop = state.roomDrops.get(state.currentRoom);
                if (drop) {
                    const name = station.items.get(drop)?.name ?? drop;
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
            name: 'attack',
            description: 'Attack the enemy',
            needsTarget: true,
            getTargets: () => {
                const room = station.rooms.get(state.currentRoom);
                if (!room?.threat) return [];
                const npc = station.npcs.get(room.threat);
                if (!npc || npc.disposition === 'dead') return [];
                return [{ label: npc.name, value: npc.name }];
            },
            toPrompt: (t) => t ? `attack the ${t}` : 'attack',
        },
        {
            name: 'interact',
            description: 'Interact with an NPC',
            needsTarget: true,
            getTargets: () => {
                return [...station.npcs.values()]
                    .filter(n => n.roomId === state.currentRoom && n.disposition !== 'dead')
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

// ─── Run Gameplay ───────────────────────────────────────────────────────────

async function runGameplay(
    client: CopilotClient,
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

    // Configure TTS for this run
    ttsEngine.setNPCs(station.npcs);

    // Tool context
    const toolCtx: ToolContext = {
        state,
        station,
        build,
        onCombatStart: () => { ui.enableCombatGlitch(); },
        onChoices: (cs) => { pendingChoices = cs; },
    };

    const tools = createGameTools(toolCtx);
    const systemMessage = buildSystemPrompt(station, build);

    // Wire TTS reveal callback — syncs text display with audio playback
    ttsEngine.onRevealChunk = (displayText, durationSec) => {
        debugLog('TTS-REVEAL-CB', `displayText=${String(displayText.length)} chars, duration=${durationSec.toFixed(2)}s, text="${displayText.slice(0, 80)}..."`);
        ui.revealChunk(displayText, durationSec);
    };

    initDebugLog();
    debugLog('SYSTEM', systemMessage);
    ui.setDebugLog(debugLog);

    // Create gameplay session
    debugLog('SESSION', 'Creating session...');
    const session = await client.createSession({
        model: 'gpt-4.1',
        streaming: true,
        tools,
        systemMessage: { content: systemMessage },
        hooks: {
            onUserPromptSubmitted: () => {
                state.turnCount++;
                state.metrics.turnCount++;

                // Tick active events
                const eventContext = eventTracker.tickActiveEvents(state);

                // Check for new random event
                const newEvent = eventTracker.checkRandomEvent(state);
                if (newEvent) {
                    state.activeEvents.push(newEvent);
                    eventContext.push(`NEW EVENT: ${newEvent.type.replace(/_/g, ' ').toUpperCase()} — ${newEvent.effect}`);
                }

                // Build context injection
                const parts: string[] = [];
                if (eventContext.length > 0) parts.push(eventContext.join('\n'));
                if (state.activeEvents.length > 0) parts.push(getEventContext(state.activeEvents));

                // NPC behavior hints
                const roomNpcs = [...station.npcs.values()].filter(n => n.roomId === state.currentRoom && n.disposition !== 'dead');
                for (const npc of roomNpcs) {
                    if (npc.behaviors.has('can_flee') && npc.currentHp < npc.maxHp * npc.fleeThreshold) {
                        parts.push(`NPC HINT: ${npc.name} looks ready to flee.`);
                    }
                    if (npc.behaviors.has('can_beg') && npc.currentHp < npc.maxHp * 0.3) {
                        parts.push(`NPC HINT: ${npc.name} is whimpering, seeming to beg for mercy.`);
                    }
                    if (npc.isAlly) {
                        parts.push(`ALLY: ${npc.name} is fighting alongside you.`);
                    }
                }

                // Moral profile hint
                const { mercy, sacrifice, pragmatic } = state.moralProfile.tendencies;
                if (mercy + sacrifice + pragmatic > 0) {
                    const dominant = mercy >= sacrifice && mercy >= pragmatic ? 'merciful'
                        : sacrifice >= pragmatic ? 'self-sacrificing' : 'pragmatic';
                    parts.push(`MORAL PROFILE: The player has shown ${dominant} tendencies.`);
                }

                if (parts.length > 0) {
                    return { additionalContext: parts.join('\n\n') };
                }
                return undefined;
            },
            onPostToolUse: (input) => {
                // After move_to: check NPC flee behavior
                if (input.toolName === 'move_to') {
                    const prevRoom = state.currentRoom;
                    for (const npc of station.npcs.values()) {
                        if (npc.roomId === prevRoom && npc.behaviors.has('can_flee') && npc.memory.hasFled) {
                            // Already handled in attack tool
                        }
                    }
                }

                // After attack: check HP for game over
                if (input.toolName === 'attack' && state.hp <= 0) {
                    state.gameOver = true;
                }

                return undefined;
            },
        },
    });

    // Wire up streaming
    let currentResponse = '';
    let streamStarted = false;
    let turnId = 0;
    session.on('assistant.message_delta', (event) => {
        const delta = event.data.deltaContent;
        currentResponse += delta;
        ui.bufferNarrativeDelta(delta);
        if (!streamStarted) {
            ttsEngine.beginStream();
            streamStarted = true;
        }
        ttsEngine.pushDelta(delta);
    });

    session.on('session.idle', () => {
        debugLog('SESSION', `idle fired, audioEnabled=${String(ttsEngine.isAudioEnabled())}`);
        if (currentResponse) {
            debugLog('AI', currentResponse);
            currentResponse = '';
        }
        streamStarted = false;
        ui.disableCombatGlitch();
        ui.updateStatus(getStatus(state, station));

        const afterStream = () => {
            debugLog('SESSION', 'afterStream — calling finalizeDelta');
            ui.finalizeDelta();
            if (pendingChoices) {
                ui.showChoiceCards(pendingChoices.title, pendingChoices.choices);
                pendingChoices = null;
            }
            if (state.gameOver) {
                ui.showGameOver(state.won);
            }
        };

        // Always flush through the pipeline (handles both audio and silent typewriter)
        const thisTurn = turnId;
        debugLog('SESSION', 'Waiting for TTS flushStream...');
        void ttsEngine.flushStream().then(() => {
            if (turnId !== thisTurn) {
                debugLog('SESSION', 'flushStream resolved but turn changed — skipping afterStream');
                return;
            }
            debugLog('SESSION', 'flushStream resolved');
            afterStream();
        }).catch((err: unknown) => {
            debugLog('SESSION', `TTS flushStream error: ${String(err)}`);
            ttsEngine.stop();
            ui.appendNarrative('*Voice system error — audio disabled for this response.*');
            afterStream();
        });
    });

    // Update UI
    ui.setSlashCommands(getSlashCommands(state, station, ttsEngine));
    ui.updateStatus(getStatus(state, station));

    // Show voice hint if no API key is set
    if (!ttsEngine.hasApiKey()) {
        ui.appendNarrative('*Type /voice to set up voice narration.*');
    }

    // Kick off the game
    const openingPrompt = `I step through the airlock onto ${station.stationName}. What do I see?`;
    debugLog('PLAYER', openingPrompt);
    debugLog('SESSION', 'Calling sendAndWait for opening prompt...');
    ui.showTypingIndicator();
    try {
        await session.sendAndWait({ prompt: openingPrompt });
        debugLog('SESSION', 'Opening sendAndWait completed.');
    } catch (err: unknown) {
        debugLog('SESSION', `Opening sendAndWait error: ${String(err)}`);
        ttsEngine.stop();
        ui.hideTypingIndicator();
        ui.finalizeDelta();
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
                    ui.appendNarrative('*That looks like a command, not an API key. Enter your OpenAI API key or /cancel:*');
                    return;
                }
                awaitingApiKey = false;
                void ttsEngine.setApiKey(input.trim()).then(() => {
                    ui.appendNarrative('*Voice narration enabled.*');
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
            ui.finalizeDelta();

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
                    ui.appendNarrative('*Enter your OpenAI API key to enable voice narration (or /cancel):*');
                    awaitingApiKey = true;
                } else {
                    const nowEnabled = !ttsEngine.isAudioEnabled();
                    ttsEngine.setAudioEnabled(nowEnabled);
                    ui.appendNarrative(nowEnabled ? '*Voice narration enabled.*' : '*Voice narration disabled.*');
                    ui.setSlashCommands(getSlashCommands(state, station, ttsEngine));
                }
                return;
            }

            debugLog('PLAYER', input);
            ui.appendPlayerCommand(input);
            ui.showTypingIndicator();
            session.sendAndWait({ prompt: input }).catch((err: unknown) => {
                debugLog('SESSION', `sendAndWait error: ${String(err)}`);
                ttsEngine.stop();
                ui.hideTypingIndicator();
                ui.finalizeDelta();
                ui.appendNarrative('*Static crackles through the comms. The station systems are unresponsive. Try again.*');
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

    // Stop any playing TTS and clean up session
    ttsEngine.stop();
    await session.destroy();
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main() {
    const client = new CopilotClient();
    const ui = new GameUI();
    await ui.init();

    // Initialize TTS (OpenAI gpt-4o-mini-tts API) — never crashes, degrades to silent typewriter
    const globalTTS = new TTSEngine({ debugLog });
    await globalTTS.init();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop exits via break
    while (true) {
        // TITLE screen — show Voice Setup option when no API key is configured
        const choice = await ui.showTitleScreen(!globalTTS.hasApiKey());
        if (choice === 'quit') {
            break;
        }

        if (choice === 'history') {
            const history = loadRunHistory();
            await ui.showRunHistory(history);
            continue;
        }

        if (choice === 'voice_setup') {
            const key = await ui.showApiKeyEntry();
            if (key) {
                try {
                    await globalTTS.setApiKey(key);
                } catch {
                    // setApiKey failed (e.g. no ffplay) — will stay in silent mode
                }
            }
            continue;
        }

        // CHARACTER SELECT
        const classId = await ui.showCharacterSelect(CHARACTER_BUILDS);

        // GENERATING
        const seed = Math.floor(Math.random() * 2147483647);
        const arc = randomStoryArc();
        ui.showGenerating();

        const skeleton = generateSkeleton({ seed, difficulty: 'normal', storyArc: arc });
        const creative = await generateCreativeContent(client, skeleton);
        const station = assembleStation(skeleton, creative);

        // GAMEPLAY
        ui.showGameplayScreen();
        await runGameplay(client, ui, station, classId, globalTTS);
    }

    await globalTTS.cleanup();
    ui.destroy();
    await client.stop();
    process.exit(0);
}

main().catch((err: unknown) => {
    process.stderr.write(`Fatal error: ${String(err)}\n`);
    process.exit(1);
});
