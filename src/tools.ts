import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import type {
    GameState,
    GeneratedStation,
    CharacterBuild,
    ActionDomain,
    ActionDifficulty,
    ActionOutcome,
    Room,
} from './types.js';
import { getProficiencyModifier } from './character.js';
import { CRAFT_RECIPES, computeActionMinutes } from './data.js';
import { computeEnvironment } from './environment.js';
import { advanceCascadeCountdowns, resolveHazardsByRepair, resolveHazardsByAction, resolveHazardsByItem } from './events.js';
import { randInt } from './generation/random-utils.js';
import {
    formatObjectiveUpdate,
    getActiveObjectiveStep,
    normalizeObjectiveChainWithLegacySupport,
    syncObjectiveProgress,
} from './objectives.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAdjacentRooms(state: GameState, station: GeneratedStation): string[] {
    const room = station.rooms.get(state.currentRoom);
    if (!room) return [];
    const connections = [...room.connections];
    // Include secret connections if discovered
    if (room.secretConnection && state.roomsVisited.has(room.secretConnection)) {
        if (!connections.includes(room.secretConnection)) {
            connections.push(room.secretConnection);
        }
    }
    return connections;
}

function getItemName(itemId: string, station: GeneratedStation): string {
    return station.items.get(itemId)?.name ?? itemId;
}

function inventoryList(state: GameState, station: GeneratedStation): { id: string; name: string }[] {
    return state.inventory.map(id => ({ id, name: getItemName(id, station) }));
}

// ─── Phase 2: Difficulty Clamping ──────────────────────────────────────────

function clampDifficulty(
    ai: ActionDifficulty,
    domain: ActionDomain,
    build: CharacterBuild,
    room: Room | undefined,
): { clamped: ActionDifficulty; adjusted: boolean } {
    const LEVELS: ActionDifficulty[] = ['trivial', 'easy', 'moderate', 'hard', 'extreme', 'impossible'];

    // Floor: active system failures in current room raise minimum difficulty
    const activeFailures = room ? room.systemFailures.filter(
        f => f.challengeState !== 'resolved' && f.challengeState !== 'failed',
    ).length : 0;
    const minIndex = activeFailures >= 2 ? 2 : activeFailures >= 1 ? 1 : 0;

    // Cap: if action domain matches character proficiency, cap at 'hard'
    const maxIndex = build.proficiencies.includes(domain) ? 3 : LEVELS.length - 1;

    const currentIndex = LEVELS.indexOf(ai);
    const clampedIndex = Math.max(minIndex, Math.min(maxIndex, currentIndex));
    return {
        clamped: LEVELS[clampedIndex],
        adjusted: clampedIndex !== currentIndex,
    };
}

// ─── Moral Choice Internal Helper ──────────────────────────────────────────

function recordMoralChoiceInternal(
    state: GameState,
    tendency: 'mercy' | 'sacrifice' | 'pragmatic',
    magnitude: number,
    description: string,
): void {
    const clampedMag = Math.max(1, Math.min(3, magnitude));
    state.moralProfile.choices.push({
        turn: state.turnCount,
        description,
        tendency,
        magnitude: clampedMag,
    });
    state.moralProfile.tendencies[tendency] += clampedMag;
}

// ─── Phase 3: Objective Progression ────────────────────────────────────────

function buildObjectiveProgressPayload(
    state: GameState,
    station: GeneratedStation,
): { objective_update?: string; objective_progress?: Record<string, unknown> } {
    const progress = syncObjectiveProgress(state, station);
    const summary = formatObjectiveUpdate(progress);
    if (!progress || !summary) return {};

    return {
        objective_update: summary,
        objective_progress: {
            missionCompleted: progress.missionCompleted,
            newlyCompletedSteps: progress.newlyCompletedSteps.map((step) => ({
                id: step.id,
                description: step.description,
                revealed: step.revealed,
            })),
            newlyRevealedSteps: progress.newlyRevealedSteps.map((step) => ({
                id: step.id,
                description: step.description,
                completed: step.completed,
            })),
            activeStep: progress.activeStep
                ? {
                    id: progress.activeStep.id,
                    description: progress.activeStep.description,
                    roomId: progress.activeStep.roomId,
                }
                : null,
        },
    };
}

// ─── Phase 4: Moral Choice Detection ───────────────────────────────────────

function detectMoralChoice(
    toolName: string,
    args: Record<string, unknown>,
    resultObj: Record<string, unknown>,
    state: GameState,
    station: GeneratedStation,
): void {
    const lastIdx = state.moralProfile.choices.length - 1;
    const alreadyThisTurn = (tendency: string) => {
        if (lastIdx < 0) return false;
        const last = state.moralProfile.choices[lastIdx];
        return last.turn === state.turnCount && last.tendency === tendency;
    };

    const success = resultObj.success === true || (typeof resultObj.outcome === 'string' && !['failure', 'critical_failure'].includes(resultObj.outcome));

    if (toolName === 'move_to') {
        const currentRoom = station.rooms.get(state.currentRoom);
        if (currentRoom) {
            const hasCriticalUnsavedSystem = currentRoom.systemFailures.some(
                f => f.minutesUntilCascade > 0 && f.minutesUntilCascade < 15 &&
                     f.challengeState !== 'resolved' && f.challengeState !== 'failed',
            );
            if (hasCriticalUnsavedSystem && !alreadyThisTurn('pragmatic')) {
                recordMoralChoiceInternal(state, 'pragmatic', 1, 'abandoned critical system failure');
            }
        }
    }

    if (toolName === 'repair_system') {
        if (success) {
            const systemId = (args.system ?? '') as string;
            const activeStep = getActiveObjectiveStep(station.objectives);
            const isObjectiveSystem = activeStep?.requiredSystemRepair === systemId;
            if (!isObjectiveSystem && !alreadyThisTurn('sacrifice')) {
                recordMoralChoiceInternal(state, 'sacrifice', 1, 'repaired non-objective system');
            }
        }
    }
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

export type ChoiceRisk = 'low' | 'medium' | 'high' | 'critical';

export interface ChoiceOption {
    label: string;
    description: string;
    risk?: ChoiceRisk;
    timeCost?: string;
    consequence?: string;
}

export interface ChoiceSet {
    title: string;
    choices: ChoiceOption[];
}
export type ChoicesCallback = (choiceSet: ChoiceSet) => void;

// ─── Game Context (captured via closure) ─────────────────────────────────

export interface GameContext {
    state: GameState;
    station: GeneratedStation;
    build: CharacterBuild;
    onChoices: ChoicesCallback;
    turnElapsedMinutes: number;
    cascadeAdvancedMinutes: number;
    /** When true, move_to is blocked so the player stays in the entry room. */
    isOpeningTurn?: boolean;
}

// ─── Tool Sets ──────────────────────────────────────────────────────────────

export interface GameToolSets {
    all: ToolSet;
}

export function createGameToolSets(classId: string, gameCtx: GameContext): GameToolSets {
    normalizeObjectiveChainWithLegacySupport(gameCtx.station.objectives);

    function advanceTime(minutes: number): void {
        gameCtx.turnElapsedMinutes += minutes;
        advanceCascadeCountdowns(gameCtx.station, minutes);
        gameCtx.cascadeAdvancedMinutes += minutes;
    }

    function defineSuggestTool(
        description: string, title: string,
        fieldName: string, fieldDesc: string, note: string,
    ) {
        const schema = z.object({
            [fieldName]: z.array(z.object({
                label: z.string().describe('Short punchy name (2-6 words)'),
                description: z.string().describe('One-sentence actionable description of what the move does right now'),
                risk: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Relative danger or commitment for this move'),
                timeCost: z.string().optional().describe('Short time or exposure cost, like "2 min" or "6 min in radiation"'),
                consequence: z.string().optional().describe('Specific tactical tradeoff or likely consequence if this move is taken'),
            })).describe(fieldDesc),
        });

        return tool({
            description,
            inputSchema: schema,
            execute: (args: z.infer<typeof schema>) => {
                const choices = (args as Record<string, ChoiceOption[]>)[fieldName];
                gameCtx.onChoices({ title, choices });
                return JSON.stringify({ presented: true, note });
            },
        });
    }

    const lookAround = tool({
        description: 'Look around the current room. Returns details about the environment, items, threats, and exits.',
        inputSchema: z.object({}),
        execute: () => {
            const { state, station } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('look_around', state, state.activeEvents, room);
            advanceTime(minutes);

            const availableItems = room.loot.filter(id => !state.itemsTaken.has(id));

            // Reveal items so pick_up_item can validate discovery
            for (const id of availableItems) state.revealedItems.add(id);

            const exits = getAdjacentRooms(state, station).map(id => {
                const r = station.rooms.get(id);
                return r ? r.name : id;
            });

            const objectives = station.objectives;
            const currentStep = getActiveObjectiveStep(objectives);
            const isObjectiveHere = currentStep !== null && currentStep.roomId === state.currentRoom && !currentStep.completed;

            return JSON.stringify({
                action_minutes: minutes,
                room_name: room.name,
                room_index: `${String([...station.rooms.keys()].indexOf(state.currentRoom) + 1)} of ${String(station.rooms.size)}`,
                description: room.descriptionSeed,
                items: availableItems.map(id => ({ id, name: getItemName(id, station) })),
                exits,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                inventory: inventoryList(state, station),
                sensory: room.sensory,
                crew_logs: room.crewLogs,
                room_modifiers: room.roomModifiers,
                revisit_context: {
                    visit_count: state.roomVisitCount.get(state.currentRoom) ?? 0,
                    is_revisit: (state.roomVisitCount.get(state.currentRoom) ?? 0) > 1,
                    all_loot_taken: availableItems.length === 0,
                },
                objective_hint: isObjectiveHere ? currentStep.description : null,
                active_events: state.activeEvents.map(e => ({ type: e.type, effect: e.effect, minutes_remaining: e.minutesRemaining })),
                system_failures: room.systemFailures
                    .filter(f => f.challengeState !== 'resolved')
                    .map(f => ({
                        system_id: f.systemId,
                        status: f.status,
                        state: f.challengeState,
                        severity: f.severity,
                        visible_symptoms: f.diagnosisHint,
                    })),
                engineering_notes: room.engineeringNotes || null,
                atmosphere: {
                    player_oxygen: state.oxygen,
                    suit_integrity: state.suitIntegrity,
                },
            });
        },
    });

    const moveTo = tool({
        description: 'Move to an adjacent room by name. Use the room names from look_around exits.',
        inputSchema: z.object({
            room: z.string().describe('Name of the room to move to'),
        }),
        execute: (args: { room: string }) => {
            const { state, station } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            // Block movement on the opening turn — player must explore the entry room first
            if (gameCtx.isOpeningTurn) {
                return JSON.stringify({ error: 'You just arrived. Explore the current room before moving.' });
            }

            // Find room by name
            let targetId: string | null = null;
            for (const [id, r] of station.rooms) {
                if (r.name.toLowerCase() === args.room.toLowerCase()) {
                    targetId = id;
                    break;
                }
            }
            // Fallback: try as room ID
            if (!targetId && station.rooms.has(args.room)) {
                targetId = args.room;
            }
            if (!targetId) return JSON.stringify({ error: `Unknown room: "${args.room}".` });

            const adjacent = getAdjacentRooms(state, station);
            if (!adjacent.includes(targetId)) {
                const targetRoom = station.rooms.get(targetId);
                return JSON.stringify({ error: `You can't reach ${targetRoom?.name ?? args.room} from here. Check available exits.` });
            }

            // Lock check
            const targetRoom = station.rooms.get(targetId);
            if (targetRoom?.lockedBy) {
                const hasKey = state.inventory.includes(targetRoom.lockedBy);
                if (!hasKey) {
                    const keyName = getItemName(targetRoom.lockedBy, station);
                    return JSON.stringify({ error: `The door is locked. You need: ${keyName}.` });
                }
            }

            // Compute travel time from current room
            const fromRoom = station.rooms.get(state.currentRoom);
            if (fromRoom) {
                const minutes = computeActionMinutes('move_to', state, state.activeEvents, fromRoom);
                advanceTime(minutes);
            }

            // Win condition: reaching escape room with objectives complete
            if (targetId === station.escapeRoomId && station.objectives.completed) {
                state.gameOver = true;
                state.won = true;
                state.currentRoom = targetId;
                state.metrics.won = true;
                return JSON.stringify({
                    success: true,
                    room_name: targetRoom?.name ?? 'Escape',
                    game_over: true,
                    won: true,
                });
            }

            // Detect moral choice before room change (checks abandoned systems in current room)
            detectMoralChoice('move_to', args as Record<string, unknown>, {}, state, station);

            state.currentRoom = targetId;
            state.roomsVisited.add(targetId);
            state.moveCount++;
            state.metrics.moveCount++;
            state.roomVisitCount.set(targetId, (state.roomVisitCount.get(targetId) ?? 0) + 1);

            const room = station.rooms.get(targetId);

            // Reveal items on room entry
            const availableItems = room ? room.loot.filter(id => !state.itemsTaken.has(id)) : [];
            for (const id of availableItems) state.revealedItems.add(id);

            const objectiveProgress = buildObjectiveProgressPayload(state, station);

            // Post-completion win check: handle edge case where objective sync
            // completes the final step during this move to the escape room
            if (targetId === station.escapeRoomId && station.objectives.completed) {
                state.gameOver = true;
                state.won = true;
                state.metrics.won = true;
            }

            return JSON.stringify({
                success: true,
                room_name: room?.name ?? targetId,
                room_index: `${String([...station.rooms.keys()].indexOf(targetId) + 1)} of ${String(station.rooms.size)}`,
                description: room?.descriptionSeed ?? '',
                items: availableItems.map(id => ({ id, name: getItemName(id, station) })),
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                sensory: room?.sensory ?? null,
                is_revisit: (state.roomVisitCount.get(targetId) ?? 0) > 1,
                system_warnings: room?.systemFailures
                    .filter(f => f.challengeState !== 'resolved')
                    .map(f => ({ system_id: f.systemId, severity: f.severity, status: f.status })) ?? [],
                atmosphere_safe: !(room?.systemFailures.some(f =>
                    (f.systemId === 'atmosphere_processor' || f.systemId === 'life_support' || f.systemId === 'pressure_seal')
                    && f.challengeState !== 'resolved'
                ) ?? false),
                ...objectiveProgress,
            });
        },
    });

    const pickUpItem = tool({
        description: 'Pick up an item in the current room. Use the item_id from move_to or look_around.',
        inputSchema: z.object({
            item: z.string().describe('Name of the item to pick up'),
        }),
        execute: (args: { item: string }) => {
            const { state, station } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('pick_up_item', state, state.activeEvents, room);
            advanceTime(minutes);

            // Find item by name
            const itemName = args.item.toLowerCase();
            let itemId: string | null = null;
            for (const [id, item] of station.items) {
                if (item.name.toLowerCase() === itemName || id.toLowerCase() === itemName) {
                    itemId = id;
                    break;
                }
            }

            if (state.inventory.length >= state.maxInventory) {
                return JSON.stringify({ success: false, reason: 'inventory_full', current: state.inventory.length, max: state.maxInventory });
            }

            // Check room loot
            const availableItems = room.loot.filter(id => !state.itemsTaken.has(id));
            // Find matching item in the available loot
            const matchId = availableItems.find(id => id === itemId || id.toLowerCase() === itemName);
            if (matchId) {
                if (!state.revealedItems.has(matchId)) {
                    return JSON.stringify({ success: false, reason: 'not_revealed' });
                }
                state.itemsTaken.add(matchId);
                const item = station.items.get(matchId);

                if (item?.effect.type === 'objective') {
                    state.hasObjectiveItem = true;
                    state.metrics.itemsCollected.push(matchId);
                    const objectiveProgress = buildObjectiveProgressPayload(state, station);
                    return JSON.stringify({
                        success: true,
                        item_id: matchId,
                        item_name: item.name,
                        is_objective_item: true,
                        ...objectiveProgress,
                    });
                }

                state.inventory.push(matchId);
                state.metrics.itemsCollected.push(matchId);
                const objectiveProgress = buildObjectiveProgressPayload(state, station);
                return JSON.stringify({
                    success: true,
                    item_id: matchId,
                    item_name: item?.name ?? matchId,
                    inventory: inventoryList(state, station),
                    slots_remaining: state.maxInventory - state.inventory.length,
                    ...objectiveProgress,
                });
            }

            if (availableItems.length === 0) {
                return JSON.stringify({ success: false, reason: 'nothing_available' });
            }
            return JSON.stringify({
                success: false,
                reason: 'not_found',
                requested: args.item,
                available_items: availableItems.map(id => ({ id, name: getItemName(id, station) })),
            });
        },
    });

    const useItem = tool({
        description: 'Use an item from your inventory. Use the item_id from look_around or pick_up_item.',
        inputSchema: z.object({
            item: z.string().describe('Item ID or name'),
        }),
        execute: (args: { item: string }) => {
            const { state, station, build } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const room = station.rooms.get(state.currentRoom);
            if (room) {
                const minutes = computeActionMinutes('use_item', state, state.activeEvents, room);
                advanceTime(minutes);
            }

            const itemName = args.item.toLowerCase();
            let foundIdx = -1;
            let foundId = '';
            for (let i = 0; i < state.inventory.length; i++) {
                const id = state.inventory[i];
                const item = station.items.get(id);
                if (id.toLowerCase() === itemName || item?.name.toLowerCase() === itemName) {
                    foundIdx = i;
                    foundId = id;
                    break;
                }
            }

            if (foundIdx === -1) {
                return JSON.stringify({ error: `You don't have "${args.item}" in your inventory.`, inventory: inventoryList(state, station) });
            }

            const item = station.items.get(foundId);
            if (!item) return JSON.stringify({ error: 'Item data missing.' });

            // Key items are not consumed
            if (item.isKeyItem) {
                return JSON.stringify({ success: false, reason: 'key_item', item_name: item.name });
            }

            // Tools are reusable — don't consume them
            const isReusable = item.effect.type === 'tool';
            if (!isReusable) {
                state.inventory.splice(foundIdx, 1);
            }
            state.metrics.itemsUsed.push(foundId);

            // Check if using this item resolves a hazard in the current room
            const itemHazardsResolved = resolveHazardsByItem(state, state.currentRoom, foundId);
            const itemHazardNames = itemHazardsResolved.length > 0
                ? itemHazardsResolved.map(h => h.type.replace(/_/g, ' '))
                : undefined;

            switch (item.effect.type) {
                case 'heal': {
                    const healAmount = build.id === 'medic' ? item.effect.value * 2 : item.effect.value;
                    const healed = Math.min(healAmount, state.maxHp - state.hp);
                    state.hp += healed;
                    state.metrics.totalDamageHealed += healed;
                    const healResultObj = { success: true, item_name: item.name, effect_type: 'heal', healed, player_hp: state.hp, player_maxHp: state.maxHp, hazards_resolved: itemHazardNames };
                    detectMoralChoice('use_item', { item: foundId } as Record<string, unknown>, healResultObj, state, station);
                    return JSON.stringify(healResultObj);
                }
                case 'tool':
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'tool', reusable: true, description: item.effect.description, hazards_resolved: itemHazardNames });
                case 'material':
                case 'component':
                case 'chemical':
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: item.effect.type, note: 'Material consumed. Primarily used for repairs and crafting.', hazards_resolved: itemHazardNames });
                default:
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: item.effect.type, hazards_resolved: itemHazardNames });
            }
        },
    });

    // ─── Action Tools ──────────────────────────────────────────────────────────

    const attemptAction = tool({
        description: 'Resolve a creative player action through dice roll. The AI assesses domain and difficulty; the game engine resolves outcome. Use for any non-standard action (barricading, hacking, improvising, etc.).',
        inputSchema: z.object({
            action: z.string().describe('What the player is attempting'),
            domain: z.enum(['tech', 'medical', 'command', 'survival', 'science']).describe('The skill domain'),
            difficulty: z.enum(['trivial', 'easy', 'moderate', 'hard', 'extreme', 'impossible']).describe('How hard this is'),
            relevant_items: z.array(z.string()).default([]).describe('Item IDs or names of inventory items that help'),
            environmental_factors: z.array(z.string()).default([]).describe('Room features that help'),
        }),
        execute: (args: { action: string; domain: ActionDomain; difficulty: ActionDifficulty; relevant_items: string[]; environmental_factors: string[] }) => {
            const { state, station, build } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const { domain, difficulty } = args;

            const room = station.rooms.get(state.currentRoom);
            const clamped = clampDifficulty(difficulty, domain, build, room);
            const effectiveDifficulty = clamped.clamped;
            if (room) {
                const minutes = computeActionMinutes('attempt_action', state, state.activeEvents, room, effectiveDifficulty);
                advanceTime(minutes);
            }

            const TARGETS: Record<ActionDifficulty, number> = {
                trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20, impossible: 5,
            };

            let target = TARGETS[effectiveDifficulty];
            const modifiers: Record<string, number> = {};

            // Proficiency
            const profMod = getProficiencyModifier(build, domain);
            if (profMod !== 0) {
                modifiers.proficiency = profMod;
                target += profMod;
            }

            // Items
            const itemBonus = Math.min(args.relevant_items.length * 5, 15);
            if (itemBonus > 0) {
                const validItems = args.relevant_items.filter(name =>
                    state.inventory.some(id => {
                        const item = station.items.get(id);
                        return item?.name.toLowerCase() === name.toLowerCase() || id.toLowerCase() === name.toLowerCase();
                    }),
                );
                const verified = validItems.length * 5;
                if (verified > 0) {
                    modifiers.items = verified;
                    target += verified;
                }
            }

            // Environment
            const envBonus = Math.min(args.environmental_factors.length * 3, 9);
            if (envBonus > 0) {
                modifiers.environment = envBonus;
                target += envBonus;
            }

            // HP penalty
            const hpPct = state.hp / state.maxHp;
            if (hpPct < 0.25) {
                modifiers.wounded = -10;
                target -= 10;
            } else if (hpPct < 0.5) {
                modifiers.wounded = -5;
                target -= 5;
            }

            target = Math.max(5, Math.min(98, target));

            const roll = randInt(1, 100);
            let outcome: ActionOutcome;
            if (roll <= Math.floor(target * 0.15)) outcome = 'critical_success';
            else if (roll <= target) outcome = 'success';
            else if (roll <= target + Math.floor((100 - target) * 0.4)) outcome = 'partial_success';
            else if (roll >= 96) outcome = 'critical_failure';
            else outcome = 'failure';

            let damageDealt = 0;
            if (outcome === 'critical_failure') {
                damageDealt = randInt(5, 15);
                state.hp = Math.max(0, state.hp - damageDealt);
                state.metrics.totalDamageTaken += damageDealt;
                if (state.hp <= 0) {
                    state.gameOver = true;
                    state.metrics.deathCause = `Critical failure: ${args.action}`;
                }
            }

            // Add room modifier on success (mechanical flag only)
            let hazardsClearedNames: string[] | undefined;
            if (outcome === 'critical_success' || outcome === 'success') {
                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    room.roomModifiers.push(`creative_action_success:${String(state.turnCount)}`);
                }

                // Resolve hazards matched by action description tags
                const resolvedHazards = resolveHazardsByAction(state, state.currentRoom, args.action, false);
                if (resolvedHazards.length > 0) {
                    hazardsClearedNames = resolvedHazards.map(h => h.type.replace(/_/g, ' '));
                }
            }

            state.metrics.creativeActionsAttempted++;

            return JSON.stringify({
                action: args.action,
                outcome,
                roll,
                target,
                modifiers,
                difficulty_used: effectiveDifficulty,
                difficulty_clamped: clamped.adjusted ? { from: difficulty, to: effectiveDifficulty } : undefined,
                damage_dealt_to_player: damageDealt > 0 ? damageDealt : undefined,
                hazards_resolved: hazardsClearedNames,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                game_over: state.gameOver || undefined,
            });
        },
    });

    const recordMoralChoice = tool({
        description: 'Record a significant moral choice the player made. Call this when the player spares an enemy, sacrifices resources, ignores a plea for help, or makes any morally significant decision.',
        inputSchema: z.object({
            description: z.string().describe('What the player chose to do'),
            tendency: z.enum(['mercy', 'sacrifice', 'pragmatic']).describe('Which moral tendency this represents'),
            magnitude: z.number().describe('How significant (1-3): 1=minor, 2=moderate, 3=major'),
        }),
        execute: (args: { description: string; tendency: 'mercy' | 'sacrifice' | 'pragmatic'; magnitude: number }) => {
            const { state } = gameCtx;
            recordMoralChoiceInternal(state, args.tendency, args.magnitude, args.description);

            return JSON.stringify({ recorded: true, tendency: args.tendency, total: state.moralProfile.tendencies[args.tendency] });
        },
    });

    const suggestActions = defineSuggestTool(
        'Present 3-5 contextual creative actions the player can attempt in the current situation. Use for non-combat situations. Actions are displayed as interactive UI buttons. Make the options tactically distinct and include risk, time cost, or tradeoff metadata whenever possible.',
        'Tactical Options',
        'actions',
        '3-5 contextual creative actions',
        'Action options displayed as interactive UI buttons. Do NOT list them in text.',
    );

    const completeObjective = tool({
        description: 'Mark the current objective step as complete when the player performs the required action in the correct room.',
        inputSchema: z.object({
            step_description: z.string().describe('Description of what was accomplished'),
        }),
        execute: (args: { step_description: string }) => {
            const { state, station } = gameCtx;

            const room = station.rooms.get(state.currentRoom);
            if (room) {
                const minutes = computeActionMinutes('complete_objective', state, state.activeEvents, room);
                advanceTime(minutes);
            }

            const objectives = station.objectives;
            normalizeObjectiveChainWithLegacySupport(objectives);
            if (objectives.currentStepIndex >= objectives.steps.length) {
                return JSON.stringify({ error: 'No more objectives.' });
            }
            const currentStep = objectives.steps[objectives.currentStepIndex];

            if (currentStep.completed) {
                return JSON.stringify({ success: true, already_completed: true, description: currentStep.description });
            }

            if (currentStep.roomId !== state.currentRoom) {
                return JSON.stringify({ success: false, reason: 'wrong_room' });
            }

            if (currentStep.requiredItemId && !state.inventory.includes(currentStep.requiredItemId) && !state.hasObjectiveItem) {
                const itemName = getItemName(currentStep.requiredItemId, station);
                return JSON.stringify({ success: false, reason: 'missing_item', required_item: itemName });
            }

            // Check system repair requirement
            if (currentStep.requiredSystemRepair) {
                const room = station.rooms.get(state.currentRoom);
                const repaired = room?.systemFailures.some(f =>
                    f.systemId === currentStep.requiredSystemRepair && f.challengeState === 'resolved'
                ) ?? false;
                if (!repaired) {
                    return JSON.stringify({ success: false, reason: 'system_not_repaired', required_system: currentStep.requiredSystemRepair });
                }
            }

            currentStep.completed = true;
            const objectiveProgress = buildObjectiveProgressPayload(state, station);
            const next = getActiveObjectiveStep(objectives);
            return JSON.stringify({
                success: true,
                description: args.step_description,
                all_complete: objectives.completed,
                next_objective: next?.description,
                next_room: next ? (station.rooms.get(next.roomId)?.name ?? next.roomId) : undefined,
                escape_room: objectives.completed
                    ? (station.rooms.get(station.escapeRoomId)?.name ?? 'escape')
                    : undefined,
                ...objectiveProgress,
            });
        },
    });

    // ─── Engineering Tools ─────────────────────────────────────────────────

    const diagnoseSystem = tool({
        description: 'Scan a failing system in the current room to determine root cause, required materials, and repair difficulty. Transitions system from detected → characterized.',
        inputSchema: z.object({
            system: z.string().describe('System ID to diagnose (e.g. "coolant_loop", "power_relay")'),
        }),
        execute: (args: { system: string }) => {
            const { state, station } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('diagnose_system', state, state.activeEvents, room);
            advanceTime(minutes);

            const failure = room.systemFailures.find(f => f.systemId === args.system && f.challengeState === 'detected');
            if (!failure) {
                const existing = room.systemFailures.find(f => f.systemId === args.system);
                if (existing) return JSON.stringify({ error: `System ${args.system} is already ${existing.challengeState}.` });
                return JSON.stringify({ error: `No ${args.system} failure detected in this room.` });
            }

            failure.challengeState = 'characterized';
            failure.technicalDetail = `${failure.failureMode} failure in ${failure.systemId}: severity ${String(failure.severity)}`;
            state.metrics.systemsDiagnosed++;

            return JSON.stringify({
                action_minutes: minutes,
                success: true,
                system_id: failure.systemId,
                failure_mode: failure.failureMode,
                severity: failure.severity,
                status: failure.status,
                required_materials: failure.requiredMaterials,
                required_skill: failure.requiredSkill,
                difficulty: failure.difficulty,
                diagnosis_hint: failure.diagnosisHint,
                cascade_minutes: failure.minutesUntilCascade > 0 ? failure.minutesUntilCascade : null,
                cascade_target: failure.cascadeTarget,
                hazard_per_minute: failure.hazardPerMinute,
                mitigation_paths: failure.mitigationPaths,
            });
        },
    });

    const stabilizeHazard = tool({
        description: 'Apply temporary mitigation to a diagnosed system failure. Buys time by doubling the cascade timer but does not fix the root cause. Easier than full repair.',
        inputSchema: z.object({
            system: z.string().describe('System ID to stabilize'),
            method: z.string().describe('How you are stabilizing it'),
        }),
        execute: (args: { system: string; method: string }) => {
            const { state, station, build } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('stabilize_hazard', state, state.activeEvents, room);
            advanceTime(minutes);

            const failure = room.systemFailures.find(f => f.systemId === args.system && f.challengeState === 'characterized');
            if (!failure) return JSON.stringify({ error: `No characterized ${args.system} failure to stabilize. Diagnose it first.` });

            const target = Math.max(5, Math.min(98,
                (failure.severity === 1 ? 85 : failure.severity === 2 ? 65 : 45)
                + getProficiencyModifier(build, failure.requiredSkill)
            ));
            const roll = randInt(1, 100);

            if (roll <= target) {
                failure.challengeState = 'stabilized';
                failure.minutesUntilCascade *= 2;
                failure.status = 'degraded';

                // Stabilize matching hazards (downgrade severity, don't fully clear)
                const resolvedHazards = resolveHazardsByAction(state, state.currentRoom, args.method, true);
                const hazardsClearedNames = resolvedHazards.map(h => h.type.replace(/_/g, ' '));

                return JSON.stringify({
                    action_minutes: minutes,
                    success: true, system_id: failure.systemId, method: args.method,
                    roll, target, new_cascade_minutes: failure.minutesUntilCascade,
                    hazards_mitigated: hazardsClearedNames.length > 0 ? hazardsClearedNames : undefined,
                });
            }

            return JSON.stringify({ action_minutes: minutes, success: false, system_id: failure.systemId, method: args.method, roll, target });
        },
    });

    const repairSystem = tool({
        description: 'Perform a full repair on a diagnosed or stabilized system failure. Requires correct materials (consumed) and a skill check. Tools are reusable.',
        inputSchema: z.object({
            system: z.string().describe('System ID to repair'),
            materials_used: z.array(z.string()).describe('Item IDs or names of materials from inventory'),
        }),
        execute: (args: { system: string; materials_used: string[] }) => {
            const { state, station, build } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const failure = room.systemFailures.find(f =>
                f.systemId === args.system && (f.challengeState === 'characterized' || f.challengeState === 'stabilized')
            );
            if (!failure) {
                const detected = room.systemFailures.find(f => f.systemId === args.system && f.challengeState === 'detected');
                if (detected) return JSON.stringify({ error: 'Diagnose the system first before attempting repair.' });
                return JSON.stringify({ error: `No repairable ${args.system} failure in this room.` });
            }

            // Compute time for repair (uses failure difficulty)
            const minutes = computeActionMinutes('repair_system', state, state.activeEvents, room, failure.difficulty);
            advanceTime(minutes);

            // Check required materials are in inventory
            const missing: string[] = [];
            for (const mat of failure.requiredMaterials) {
                const found = state.inventory.some(id =>
                    id === mat || station.items.get(id)?.name.toLowerCase() === mat.replace(/_/g, ' ')
                );
                if (!found) missing.push(mat);
            }
            if (missing.length > 0) {
                return JSON.stringify({ error: 'Missing required materials.', missing, required: failure.requiredMaterials, inventory: inventoryList(state, station) });
            }

            // Skill check
            const TARGETS: Record<ActionDifficulty, number> = {
                trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20, impossible: 5,
            };
            let target = TARGETS[failure.difficulty] + getProficiencyModifier(build, failure.requiredSkill);
            if (failure.challengeState === 'stabilized') target += 10;
            target = Math.max(5, Math.min(98, target));

            const roll = randInt(1, 100);
            let outcome: ActionOutcome;
            if (roll <= Math.floor(target * 0.15)) outcome = 'critical_success';
            else if (roll <= target) outcome = 'success';
            else if (roll <= target + 15) outcome = 'partial_success';
            else if (roll >= 96) outcome = 'critical_failure';
            else outcome = 'failure';

            // Consume materials (tools are reusable)
            for (const mat of failure.requiredMaterials) {
                const idx = state.inventory.findIndex(id => {
                    const item = station.items.get(id);
                    if (item?.effect.type === 'tool') return false;
                    return id === mat || item?.name.toLowerCase() === mat.replace(/_/g, ' ');
                });
                if (idx >= 0) state.inventory.splice(idx, 1);
            }

            if (outcome === 'critical_success' || outcome === 'success') {
                failure.challengeState = 'resolved';
                failure.status = 'repaired';
                state.repairedSystems.add(`${failure.systemId}:${state.currentRoom}`);
                state.metrics.systemsRepaired++;

                // Resolve matching hazards in this room
                const resolvedHazards = resolveHazardsByRepair(state, state.currentRoom, failure.systemId);
                const hazardsClearedNames = resolvedHazards.map(h => h.type.replace(/_/g, ' '));

                const objectiveProgress = buildObjectiveProgressPayload(state, station);
                const repairResultObj = {
                    action_minutes: minutes,
                    success: true, outcome, system_id: failure.systemId, roll, target,
                    hazards_resolved: hazardsClearedNames.length > 0 ? hazardsClearedNames : undefined,
                    inventory: inventoryList(state, station),
                    ...objectiveProgress,
                };
                detectMoralChoice('repair_system', args as Record<string, unknown>, repairResultObj, state, station);
                return JSON.stringify(repairResultObj);
            }
            if (outcome === 'partial_success') {
                if (failure.challengeState !== 'stabilized') {
                    failure.challengeState = 'stabilized';
                    failure.minutesUntilCascade += 30;
                }
                return JSON.stringify({
                    action_minutes: minutes,
                    success: false, partial: true, outcome, system_id: failure.systemId, roll, target,
                    note: 'Repair incomplete but system stabilized.',
                    inventory: inventoryList(state, station),
                });
            }
            // Failure or critical failure
            let dmg = 0;
            if (outcome === 'critical_failure') {
                dmg = randInt(5, 15);
                state.hp = Math.max(0, state.hp - dmg);
                state.metrics.totalDamageTaken += dmg;
                if (state.hp <= 0) {
                    state.gameOver = true;
                    state.metrics.deathCause = `Critical repair failure: ${failure.systemId}`;
                }
            }
            return JSON.stringify({
                success: false, outcome, system_id: failure.systemId, roll, target,
                damage_taken: dmg > 0 ? dmg : undefined,
                player_hp: state.hp,
                inventory: inventoryList(state, station),
            });
        },
    });

    const improviseRepair = tool({
        description: '"Science the hell out of it" — fix a system failure with non-standard materials and creative reasoning. Higher difficulty but always possible.',
        inputSchema: z.object({
            system: z.string().describe('System ID to repair'),
            approach: z.string().describe('How you plan to improvise the repair'),
            materials_used: z.array(z.string()).describe('Item IDs or names of non-standard materials from inventory'),
        }),
        execute: (args: { system: string; approach: string; materials_used: string[] }) => {
            const { state, station, build } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('improvise_repair', state, state.activeEvents, room);
            advanceTime(minutes);

            const failure = room.systemFailures.find(f =>
                f.systemId === args.system && (f.challengeState === 'characterized' || f.challengeState === 'stabilized')
            );
            if (!failure) return JSON.stringify({ error: `No diagnosed ${args.system} failure to repair.` });

            // Verify at least one material is in inventory
            const validMaterials = args.materials_used.filter(name =>
                state.inventory.some(id => {
                    const item = station.items.get(id);
                    return id.toLowerCase() === name.toLowerCase() || (item?.name.toLowerCase() === name.toLowerCase());
                })
            );
            if (validMaterials.length === 0) {
                return JSON.stringify({ error: 'You need at least one material from your inventory.', inventory: inventoryList(state, station) });
            }

            // Higher difficulty than standard repair
            const TARGETS: Record<ActionDifficulty, number> = {
                trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20, impossible: 5,
            };
            const harderDifficulty: ActionDifficulty =
                failure.difficulty === 'trivial' ? 'easy' :
                failure.difficulty === 'easy' ? 'moderate' :
                failure.difficulty === 'moderate' ? 'hard' :
                failure.difficulty === 'hard' ? 'extreme' : 'extreme';

            let target = TARGETS[harderDifficulty]
                + getProficiencyModifier(build, failure.requiredSkill)
                + Math.min(validMaterials.length * 5, 15);
            target = Math.max(5, Math.min(98, target));

            const roll = randInt(1, 100);
            const success = roll <= target;

            // Consume materials (except tools)
            for (const name of validMaterials) {
                const idx = state.inventory.findIndex(id => {
                    const item = station.items.get(id);
                    if (item?.effect.type === 'tool') return false;
                    return id.toLowerCase() === name.toLowerCase() || (item?.name.toLowerCase() === name.toLowerCase());
                });
                if (idx >= 0) state.inventory.splice(idx, 1);
            }

            if (success) {
                failure.challengeState = 'resolved';
                failure.status = 'repaired';
                state.repairedSystems.add(`${failure.systemId}:${state.currentRoom}`);
                state.metrics.systemsRepaired++;
                state.metrics.improvizedSolutions++;
                state.improvizedSolutions++;

                // Resolve matching hazards
                const resolvedHazards = resolveHazardsByRepair(state, state.currentRoom, failure.systemId);
                const hazardsClearedNames = resolvedHazards.map(h => h.type.replace(/_/g, ' '));

                return JSON.stringify({
                    success: true, system_id: failure.systemId, approach: args.approach,
                    roll, target, improvised: true,
                    hazards_resolved: hazardsClearedNames.length > 0 ? hazardsClearedNames : undefined,
                    inventory: inventoryList(state, station),
                });
            }

            return JSON.stringify({
                success: false, system_id: failure.systemId, approach: args.approach, roll, target,
                inventory: inventoryList(state, station),
            });
        },
    });

    const craftItem = tool({
        description: 'Combine inventory materials to create a new component. Uses known recipes. Consumes ingredients on success.',
        inputSchema: z.object({
            ingredients: z.array(z.string()).describe('Item IDs or names of materials to combine'),
            intended_result: z.string().describe('What you are trying to create'),
        }),
        execute: (args: { ingredients: string[]; intended_result: string }) => {
            const { state, station, build } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const room = station.rooms.get(state.currentRoom);
            if (room) {
                const minutes = computeActionMinutes('craft_item', state, state.activeEvents, room);
                advanceTime(minutes);
            }

            const normalizedIngredients = args.ingredients.map(n => n.toLowerCase());
            const recipe = CRAFT_RECIPES.find(r => {
                const ri = r.ingredients.map(i => i.toLowerCase());
                return ri.length === normalizedIngredients.length &&
                    ri.every(i => normalizedIngredients.includes(i));
            });

            if (!recipe) {
                return JSON.stringify({
                    success: false, reason: 'no_recipe', ingredients: args.ingredients,
                    intended: args.intended_result,
                    note: 'No known recipe for this combination. Try different materials or use improvise_repair for non-standard fixes.',
                });
            }

            // Verify ingredients in inventory
            const missing: string[] = [];
            for (const ingredient of recipe.ingredients) {
                const found = state.inventory.some(id =>
                    id === ingredient || station.items.get(id)?.name.toLowerCase() === ingredient.replace(/_/g, ' ')
                );
                if (!found) missing.push(ingredient);
            }
            if (missing.length > 0) return JSON.stringify({ error: 'Missing ingredients.', missing });

            // Check required tool
            if (recipe.requiredTool) {
                const reqTool = recipe.requiredTool;
                const hasTool = state.inventory.some(id =>
                    id === reqTool || station.items.get(id)?.name.toLowerCase() === reqTool.replace(/_/g, ' ')
                );
                if (!hasTool) return JSON.stringify({ error: `Requires ${reqTool} tool.` });
            }

            // Skill check
            const TARGETS: Record<ActionDifficulty, number> = {
                trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20, impossible: 5,
            };
            let target = TARGETS[recipe.difficulty] + getProficiencyModifier(build, 'tech');
            if (build.id === 'scientist') target += 15; // Scientist class bonus
            target = Math.max(5, Math.min(98, target));

            const roll = randInt(1, 100);
            if (roll > target) {
                return JSON.stringify({ success: false, intended: recipe.resultName, roll, target, note: 'Crafting failed. Materials not consumed.' });
            }

            // Consume ingredients (not tools)
            for (const ingredient of recipe.ingredients) {
                const idx = state.inventory.findIndex(id =>
                    id === ingredient || station.items.get(id)?.name.toLowerCase() === ingredient.replace(/_/g, ' ')
                );
                if (idx >= 0) state.inventory.splice(idx, 1);
            }

            // Add crafted item
            if (!station.items.has(recipe.resultId)) {
                station.items.set(recipe.resultId, {
                    id: recipe.resultId,
                    name: recipe.resultName,
                    description: `Crafted: ${recipe.resultName}`,
                    category: 'component',
                    effect: { type: 'component', value: 1, description: recipe.resultName },
                    isKeyItem: false,
                    useNarration: `You use the ${recipe.resultName}.`,
                });
            }
            state.inventory.push(recipe.resultId);
            state.craftedItems.push(recipe.resultId);
            state.metrics.itemsCrafted++;
            const objectiveProgress = buildObjectiveProgressPayload(state, station);

            return JSON.stringify({
                success: true, crafted: recipe.resultName, roll, target,
                inventory: inventoryList(state, station),
                ...objectiveProgress,
            });
        },
    });

    const analyzeItem = tool({
        description: 'Examine an inventory item. Use the item_id from look_around or pick_up_item.',
        inputSchema: z.object({
            item: z.string().describe('Item ID or name'),
        }),
        execute: (args: { item: string }) => {
            const { state, station } = gameCtx;

            const room = station.rooms.get(state.currentRoom);
            if (room) {
                const minutes = computeActionMinutes('analyze_item', state, state.activeEvents, room);
                advanceTime(minutes);
            }

            const itemName = args.item.toLowerCase();

            let itemId: string | null = null;
            for (const id of state.inventory) {
                const item = station.items.get(id);
                if (id.toLowerCase() === itemName || item?.name.toLowerCase() === itemName) {
                    itemId = id;
                    break;
                }
            }
            if (!itemId) return JSON.stringify({ error: `"${args.item}" not in inventory.`, inventory: inventoryList(state, station) });

            const item = station.items.get(itemId);
            if (!item) return JSON.stringify({ error: 'Item data missing.' });

            const recipes = CRAFT_RECIPES.filter(r => r.ingredients.includes(itemId));
            const currentRoom = station.rooms.get(state.currentRoom);
            const applicableFailures = currentRoom?.systemFailures
                .filter(f => f.requiredMaterials.includes(itemId) && f.challengeState !== 'resolved' && f.challengeState !== 'failed')
                .map(f => ({ systemId: f.systemId, state: f.challengeState })) ?? [];

            return JSON.stringify({
                item_id: itemId,
                item_name: item.name,
                description: item.description,
                category: item.category,
                effect_type: item.effect.type,
                is_reusable: item.effect.type === 'tool',
                is_key_item: item.isKeyItem,
                craft_recipes: recipes.map(r => ({
                    result: r.resultName,
                    other_ingredients: r.ingredients.filter(i => i !== itemId),
                    tool_required: r.requiredTool,
                })),
                applicable_repairs: applicableFailures,
            });
        },
    });

    const checkEnvironment = tool({
        description: 'Read environmental sensors in the current room: atmosphere composition, pressure, temperature, radiation, structural data, and derived physics (partial pressures, boiling points, dose equivalents). Returns raw numbers plus computed values for engineering assessment.',
        inputSchema: z.object({}),
        execute: () => {
            const { state, station } = gameCtx;
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const minutes = computeActionMinutes('check_environment', state, state.activeEvents, room);
            advanceTime(minutes);

            // Only use events localized to this room (or global/legacy events)
            const roomEvents = state.activeEvents.filter(e => !e.roomId || e.roomId === state.currentRoom);
            const env = computeEnvironment(room, roomEvents);
            const failures = room.systemFailures.filter(f => f.challengeState !== 'resolved');

            // Additional derived physics for the AI (beyond EnvironmentSnapshot)
            const ppCO2 = Math.round(env.co2Ppm / 1e6 * env.pressureKpa * 1000) / 1000;
            const co2Risk: 'nominal' | 'elevated' | 'dangerous' | 'critical' =
                env.co2Ppm >= 40000 ? 'critical' : env.co2Ppm >= 20000 ? 'dangerous' :
                env.co2Ppm >= 5000 ? 'elevated' : 'nominal';

            const boilingPointC = Math.round((100 - 0.27 * (101.325 - env.pressureKpa)) * 10) / 10;

            const radiationAnnualMsv = Math.round(env.radiationMsv * 8760 * 10) / 10;
            const radiationCategory: 'background' | 'elevated' | 'exceeds_annual_limit' | 'lethal_hours' | 'lethal_minutes' =
                env.radiationMsv >= 500 ? 'lethal_minutes' : env.radiationMsv >= 50 ? 'lethal_hours' :
                radiationAnnualMsv > 50 ? 'exceeds_annual_limit' :
                radiationAnnualMsv > 1 ? 'elevated' : 'background';

            const pressureDiffKpa = Math.round((101.325 - env.pressureKpa) * 10) / 10;
            const suitLeakPctPerMin = Math.round(Math.max(0, pressureDiffKpa / 10 * 0.5) * 100) / 100;

            return JSON.stringify({
                room_name: room.name,
                atmosphere: {
                    oxygen_pct: env.oxygenPct,
                    co2_ppm: env.co2Ppm,
                    pressure_kpa: env.pressureKpa,
                    contaminants: failures.some(f => f.failureMode === 'contamination') ? 'detected' : 'nominal',
                },
                temperature_c: env.temperatureC,
                radiation_msv: env.radiationMsv,
                structural_integrity_pct: env.structuralPct,
                gravity_g: env.gravityG,
                power_status: env.powerStatus,
                system_failures_detected: env.activeFailureCount,
                player_oxygen: state.oxygen,
                player_suit_integrity: state.suitIntegrity,
                derived: {
                    o2_partial_pressure_kpa: env.ppO2,
                    hypoxia_risk: env.hypoxiaRisk,
                    co2_partial_pressure_kpa: ppCO2,
                    co2_risk: co2Risk,
                    water_boiling_point_c: boilingPointC,
                    radiation_annual_equiv_msv: radiationAnnualMsv,
                    radiation_category: radiationCategory,
                    pressure_differential_kpa: pressureDiffKpa,
                    suit_leak_rate_pct_per_min: suitLeakPctPerMin,
                },
            });
        },
    });

    const suggestDiagnostics = defineSuggestTool(
        'Present 3-5 contextual engineering diagnostic actions. Call when the player wants to investigate or repair systems but hasn\'t specified a specific action. Make the options feel like tactical engineering decisions, not generic prompts, and include risk, time cost, or tradeoff metadata whenever possible.',
        'Engineering Decision Point',
        'diagnostics',
        '3-5 contextual engineering actions',
        'Diagnostic options displayed as interactive UI buttons. Focus on engineering: characterize failures, check sensors, analyze components. Do NOT list in text.',
    );

    // ─── Class-Specific Tools ───────────────────────────────────────────────

    let bypassSystem: ToolSet[string] | null = null;
    let fieldSurgery: ToolSet[string] | null = null;
    let crisisAssessment: ToolSet[string] | null = null;

    if (classId === 'engineer') {
        bypassSystem = tool({
            description: 'Bypass a locked door without a keycard, repair severity-1 failures without materials, or reveal secret passages. Engineer class ability. Requires multitool.',
            inputSchema: z.object({
                target: z.string().describe('What to bypass or repair'),
            }),
            execute: (args: { target: string }) => {
                const { state, station } = gameCtx;
                if (!state.inventory.some(id => id === 'multitool' || station.items.get(id)?.name.toLowerCase().includes('multitool'))) {
                    return JSON.stringify({ error: 'You need a multitool for this.' });
                }

                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    const minutes = computeActionMinutes('bypass_system', state, state.activeEvents, room);
                    advanceTime(minutes);
                }

                // Check for severity-1 system failures to auto-repair
                if (room) {
                    const minorFailure = room.systemFailures.find(f =>
                        f.severity === 1 &&
                        f.challengeState !== 'resolved' && f.challengeState !== 'failed' &&
                        f.systemId.includes(args.target.toLowerCase().replace(/ /g, '_'))
                    );
                    if (minorFailure) {
                        minorFailure.challengeState = 'resolved';
                        minorFailure.status = 'repaired';
                        state.repairedSystems.add(`${minorFailure.systemId}:${state.currentRoom}`);
                        state.metrics.systemsRepaired++;
                        return JSON.stringify({ success: true, action: 'bypass_repair', system: minorFailure.systemId, note: 'Minor failure bypassed with multitool.' });
                    }
                }

                // Check adjacent rooms for locked doors
                const adjacent = getAdjacentRooms(state, station);
                for (const adjId of adjacent) {
                    const adjRoom = station.rooms.get(adjId);
                    if (adjRoom?.lockedBy && adjRoom.name.toLowerCase().includes(args.target.toLowerCase())) {
                        adjRoom.lockedBy = null;
                        return JSON.stringify({ success: true, action: 'bypass_lock', target_room: adjRoom.name });
                    }
                }

                // Check for secret connections
                if (room?.secretConnection) {
                    const secretRoom = station.rooms.get(room.secretConnection);
                    if (secretRoom && !room.connections.includes(room.secretConnection)) {
                        room.connections.push(room.secretConnection);
                        secretRoom.connections.push(state.currentRoom);
                        return JSON.stringify({ success: true, action: 'reveal_passage', target_room: secretRoom.name });
                    }
                }

                return JSON.stringify({ success: true, action: 'generic' });
            },
        });
    }

    if (classId === 'medic') {
        fieldSurgery = tool({
            description: 'Heal 15 HP using medical expertise. Usable once per room. Medic class ability.',
            inputSchema: z.object({}),
            execute: () => {
                const { state, station } = gameCtx;
                if (state.fieldSurgeryUsedInRoom.has(state.currentRoom)) {
                    return JSON.stringify({ error: 'You already performed field surgery in this room.' });
                }
                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    const minutes = computeActionMinutes('field_surgery', state, state.activeEvents, room);
                    advanceTime(minutes);
                }
                const healed = Math.min(15, state.maxHp - state.hp);
                state.hp += healed;
                state.metrics.totalDamageHealed += healed;
                state.fieldSurgeryUsedInRoom.add(state.currentRoom);
                return JSON.stringify({ success: true, healed, player_hp: state.hp, player_maxHp: state.maxHp });
            },
        });
    }

    if (classId === 'commander') {
        crisisAssessment = tool({
            description: 'Reveal cascade timers and failure states in all adjacent rooms. Commander class ability.',
            inputSchema: z.object({}),
            execute: () => {
                const { state, station } = gameCtx;

                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    const minutes = computeActionMinutes('crisis_assessment', state, state.activeEvents, room);
                    advanceTime(minutes);
                }

                const adjacent = getAdjacentRooms(state, station);
                const assessments = adjacent.map(id => {
                    const adjRoom = station.rooms.get(id);
                    if (!adjRoom) return { room_id: id, failures: [] };
                    return {
                        room_name: adjRoom.name,
                        failures: adjRoom.systemFailures
                            .filter(f => f.challengeState !== 'resolved')
                            .map(f => ({
                                system_id: f.systemId,
                                severity: f.severity,
                                state: f.challengeState,
                                cascade_minutes: f.minutesUntilCascade > 0 ? f.minutesUntilCascade : null,
                                cascade_target: f.cascadeTarget,
                            })),
                    };
                });
                return JSON.stringify({ success: true, adjacent_assessments: assessments });
            },
        });
    }

    // ─── Assemble Tool Sets ─────────────────────────────────────────────────

    const all: ToolSet = {
        look_around: lookAround,
        move_to: moveTo,
        pick_up_item: pickUpItem,
        use_item: useItem,
        diagnose_system: diagnoseSystem,
        stabilize_hazard: stabilizeHazard,
        repair_system: repairSystem,
        improvise_repair: improviseRepair,
        craft_item: craftItem,
        analyze_item: analyzeItem,
        check_environment: checkEnvironment,
        suggest_diagnostics: suggestDiagnostics,
        suggest_actions: suggestActions,
        attempt_action: attemptAction,
        record_moral_choice: recordMoralChoice,
        complete_objective: completeObjective,
    };
    if (bypassSystem) all['bypass_system'] = bypassSystem;
    if (fieldSurgery) all['field_surgery'] = fieldSurgery;
    if (crisisAssessment) all['crisis_assessment'] = crisisAssessment;

    return { all };
}
