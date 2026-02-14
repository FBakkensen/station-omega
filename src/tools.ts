import { tool } from '@openai/agents';
import type { RunContext, Tool } from '@openai/agents';
import { z } from 'zod';
import type {
    GameState,
    GeneratedStation,
    CharacterBuild,
    ActionDomain,
    ActionDifficulty,
    ActionOutcome,
    Disposition,
    NPC,
} from './types.js';
import { getProficiencyModifier } from './character.js';
import { CRAFT_RECIPES } from './data.js';
import { computeEnvironment } from './environment.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

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

function getNPCsInRoom(roomId: string, station: GeneratedStation): NPC[] {
    return [...station.npcs.values()].filter(npc => npc.roomId === roomId);
}

function getItemName(itemId: string, station: GeneratedStation): string {
    return station.items.get(itemId)?.name ?? itemId;
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

export interface ChoiceSet {
    title: string;
    choices: { label: string; description: string }[];
}
export type ChoicesCallback = (choiceSet: ChoiceSet) => void;

// ─── Game Context (injected via RunContext) ─────────────────────────────────

export interface GameContext {
    state: GameState;
    station: GeneratedStation;
    build: CharacterBuild;
    onChoices: ChoicesCallback;
}

function getCtx(ctx: RunContext<GameContext> | undefined): GameContext {
    if (!ctx) throw new Error('RunContext missing — tool called outside of agent run');
    return ctx.context;
}

// ─── Suggest Tool Helper ────────────────────────────────────────────────────

function defineSuggestTool(
    name: string, description: string, title: string,
    fieldName: string, fieldDesc: string, note: string,
): Tool<GameContext> {
    // Zod schema for suggestion tools: an array of {label, description} under a dynamic key
    const schema = z.object({
        [fieldName]: z.array(z.object({
            label: z.string().describe('Short punchy name (2-6 words)'),
            description: z.string().describe('One-sentence evocative description'),
        })).describe(fieldDesc),
    });

    return tool({
        name,
        description,
        parameters: schema,
        execute: (args: z.infer<typeof schema>, ctx?: RunContext<GameContext>) => {
            const choices = (args as Record<string, { label: string; description: string }[]>)[fieldName];
            ctx?.context.onChoices({ title, choices });
            return JSON.stringify({ presented: true, note });
        },
    });
}

// ─── Tool Sets ──────────────────────────────────────────────────────────────

export interface GameToolSets {
    all: Tool<GameContext>[];           // All tools (orchestrator)
    engineering: Tool<GameContext>[];   // diagnose, stabilize, repair, improvise, craft, attack, use_item
    diagnostics: Tool<GameContext>[];   // check_environment, analyze_item, look_around, suggest_diagnostics
    exploration: Tool<GameContext>[];   // look_around, move_to, pick_up_item, attempt_action,
                                        // suggest_actions, complete_objective, field_surgery,
                                        // [bypass_system], [crisis_assessment]
}

export function createGameToolSets(classId: string): GameToolSets {

    const lookAround = tool({
        name: 'look_around',
        description: 'Look around the current room. Returns details about the environment, items, threats, and exits.',
        parameters: z.object({}),
        execute: (_args, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const lootPresent = room.loot && !state.roomLootTaken.has(state.currentRoom);

            // Reveal items so pick_up_item can validate discovery
            if (lootPresent && room.loot) state.revealedItems.add(room.loot);

            const exits = getAdjacentRooms(state, station).map(id => {
                const r = station.rooms.get(id);
                return r ? r.name : id;
            });

            const objectives = station.objectives;
            const currentStep = objectives.steps[objectives.currentStepIndex] as typeof objectives.steps[number] | undefined;
            const isObjectiveHere = currentStep !== undefined && currentStep.roomId === state.currentRoom && !currentStep.completed;

            return JSON.stringify({
                room_name: room.name,
                room_index: `${String([...station.rooms.keys()].indexOf(state.currentRoom) + 1)} of ${String(station.rooms.size)}`,
                description: room.descriptionSeed,
                item_visible: lootPresent && room.loot ? getItemName(room.loot, station) : null,
                npcs_present: getNPCsInRoom(state.currentRoom, station).map(npc => ({
                    id: npc.id,
                    name: npc.name,
                    disposition: npc.disposition,
                    is_ally: npc.isAlly,
                })),
                exits,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                inventory: state.inventory.length > 0 ? state.inventory.map(id => getItemName(id, station)) : ['empty'],
                sensory: room.sensory,
                crew_logs: room.crewLogs,
                room_modifiers: room.roomModifiers,
                revisit_context: {
                    visit_count: state.roomVisitCount.get(state.currentRoom) ?? 0,
                    is_revisit: (state.roomVisitCount.get(state.currentRoom) ?? 0) > 1,
                    loot_taken_here: state.roomLootTaken.has(state.currentRoom),
                },
                objective_hint: isObjectiveHere ? currentStep.description : null,
                active_events: state.activeEvents.map(e => ({ type: e.type, effect: e.effect, turns_remaining: e.turnsRemaining })),
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
        name: 'move_to',
        description: 'Move to an adjacent room by name. Use the room names from look_around exits.',
        parameters: z.object({
            room: z.string().describe('Name of the room to move to'),
        }),
        execute: (args: { room: string }, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            // Find room by name
            let targetId: string | null = null;
            for (const [id, r] of station.rooms) {
                if (r.name.toLowerCase() === args.room.toLowerCase()) {
                    targetId = id;
                    break;
                }
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

            state.currentRoom = targetId;
            state.roomsVisited.add(targetId);
            state.moveCount++;
            state.metrics.moveCount++;
            state.roomVisitCount.set(targetId, (state.roomVisitCount.get(targetId) ?? 0) + 1);

            const room = station.rooms.get(targetId);

            // Reveal items on room entry
            const lootPresent = room?.loot && !state.roomLootTaken.has(targetId);
            if (lootPresent && room.loot) state.revealedItems.add(room.loot);

            return JSON.stringify({
                success: true,
                room_name: room?.name ?? targetId,
                room_index: `${String([...station.rooms.keys()].indexOf(targetId) + 1)} of ${String(station.rooms.size)}`,
                description: room?.descriptionSeed ?? '',
                item_visible: lootPresent && room.loot ? getItemName(room.loot, station) : null,
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
            });
        },
    });

    const pickUpItem = tool({
        name: 'pick_up_item',
        description: 'Pick up an item in the current room and add it to your inventory.',
        parameters: z.object({
            item: z.string().describe('Name of the item to pick up'),
        }),
        execute: (args: { item: string }, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

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
            const roomLootAvailable = room.loot && !state.roomLootTaken.has(state.currentRoom);
            if (roomLootAvailable && room.loot && (room.loot === itemId || room.loot.toLowerCase() === itemName)) {
                if (!state.revealedItems.has(room.loot)) {
                    return JSON.stringify({ success: false, reason: 'not_revealed' });
                }
                const actualId = room.loot;
                state.roomLootTaken.add(state.currentRoom);
                const item = station.items.get(actualId);

                if (item?.effect.type === 'objective') {
                    state.hasObjectiveItem = true;
                    state.metrics.itemsCollected.push(actualId);
                    return JSON.stringify({
                        success: true,
                        item_id: actualId,
                        item_name: item.name,
                        is_objective_item: true,
                    });
                }

                state.inventory.push(actualId);
                state.metrics.itemsCollected.push(actualId);
                return JSON.stringify({
                    success: true,
                    item_id: actualId,
                    item_name: item?.name ?? actualId,
                    inventory: state.inventory.map(id => getItemName(id, station)),
                    slots_remaining: state.maxInventory - state.inventory.length,
                });
            }

            if (!roomLootAvailable) {
                return JSON.stringify({ success: false, reason: 'nothing_available' });
            }
            return JSON.stringify({ success: false, reason: 'not_found', requested: args.item });
        },
    });

    const useItem = tool({
        name: 'use_item',
        description: 'Use an item from your inventory. Effects vary by item type: medical items heal, weapon items boost damage, utility items have special effects.',
        parameters: z.object({
            item: z.string().describe('Name of the item to use'),
        }),
        execute: (args: { item: string }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

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
                return JSON.stringify({ error: `You don't have "${args.item}" in your inventory.`, inventory: state.inventory.map(id => getItemName(id, station)) });
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

            switch (item.effect.type) {
                case 'heal': {
                    const healAmount = build.id === 'medic' ? item.effect.value * 2 : item.effect.value;
                    const healed = Math.min(healAmount, state.maxHp - state.hp);
                    state.hp += healed;
                    state.metrics.totalDamageHealed += healed;
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'heal', healed, player_hp: state.hp, player_maxHp: state.maxHp });
                }
                case 'tool':
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'tool', reusable: true, description: item.effect.description });
                case 'material':
                case 'component':
                case 'chemical':
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: item.effect.type, note: 'Material consumed. Primarily used for repairs and crafting.' });
                default:
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: item.effect.type });
            }
        },
    });

    // ─── Action Tools ──────────────────────────────────────────────────────────

    const attemptAction = tool({
        name: 'attempt_action',
        description: 'Resolve a creative player action through dice roll. The AI assesses domain and difficulty; the game engine resolves outcome. Use for any non-standard action (barricading, hacking, improvising, etc.).',
        parameters: z.object({
            action: z.string().describe('What the player is attempting'),
            domain: z.enum(['tech', 'medical', 'social', 'survival', 'science']).describe('The skill domain'),
            difficulty: z.enum(['trivial', 'easy', 'moderate', 'hard', 'extreme', 'impossible']).describe('How hard this is'),
            relevant_items: z.array(z.string()).default([]).describe('Inventory items that help'),
            environmental_factors: z.array(z.string()).default([]).describe('Room features that help'),
        }),
        execute: (args: { action: string; domain: ActionDomain; difficulty: ActionDifficulty; relevant_items: string[]; environmental_factors: string[] }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const { domain, difficulty } = args;

            const TARGETS: Record<ActionDifficulty, number> = {
                trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20, impossible: 5,
            };

            let target = TARGETS[difficulty];
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
            if (outcome === 'critical_success' || outcome === 'success') {
                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    room.roomModifiers.push(`creative_action_success:${String(state.turnCount)}`);
                }
            }

            state.metrics.creativeActionsAttempted++;

            return JSON.stringify({
                action: args.action,
                outcome,
                roll,
                target,
                modifiers,
                damage_dealt_to_player: damageDealt > 0 ? damageDealt : undefined,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                game_over: state.gameOver || undefined,
            });
        },
    });

    const interactNPC = tool({
        name: 'interact_npc',
        description: 'Interact with an NPC non-violently. Negotiate, intimidate, trade, or recruit. Only works on NPCs with appropriate behavior flags.',
        parameters: z.object({
            approach: z.enum(['negotiate', 'intimidate', 'offer_mercy', 'trade', 'ask_info', 'recruit']).describe('Interaction approach'),
            target_npc: z.string().describe('Name of the NPC'),
            leverage: z.string().default('').describe('What the player is offering or using as leverage'),
            tone: z.enum(['aggressive', 'calm', 'desperate', 'commanding', 'empathetic']).describe('Tone of approach'),
        }),
        execute: (args: { approach: string; target_npc: string; leverage: string; tone: string }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            // Find NPC by name
            let npc: NPC | null = null;
            for (const n of station.npcs.values()) {
                if (n.name.toLowerCase() === args.target_npc.toLowerCase() && n.roomId === state.currentRoom) {
                    npc = n;
                    break;
                }
            }
            if (!npc) return JSON.stringify({ error: `No NPC named "${args.target_npc}" is here.` });

            // Check behavior compatibility
            const approach = args.approach;
            if (approach === 'negotiate' && !npc.behaviors.has('can_negotiate') && !npc.behaviors.has('is_intelligent')) {
                return JSON.stringify({ error: `${npc.name} cannot be reasoned with.` });
            }
            if (approach === 'trade' && !npc.behaviors.has('can_trade')) {
                return JSON.stringify({ error: `${npc.name} has nothing to trade.` });
            }
            if (approach === 'recruit' && !npc.behaviors.has('can_ally')) {
                return JSON.stringify({ error: `${npc.name} will not join you.` });
            }

            // Base chance from disposition
            const BASE: Record<Disposition, number> = { neutral: 60, friendly: 85, fearful: 75 };
            let chance = BASE[npc.disposition];

            // Social proficiency
            const socialMod = getProficiencyModifier(build, 'social');
            chance += socialMod;

            // Tone matching bonus
            const toneBonus = getToneBonus(args.tone, approach, npc.disposition);
            chance += toneBonus;

            // Mercy reputation bonus
            const mercyBonus = state.moralProfile.tendencies.mercy * 3;
            chance += Math.min(mercyBonus, 15);

            chance = Math.max(5, Math.min(95, chance));
            const roll = randInt(1, 100);
            const success = roll <= chance;

            npc.memory.playerActions.push(`${approach} (${args.tone})`);
            state.metrics.npcInteractions++;

            if (success) {
                const prevDisposition = npc.disposition;
                switch (approach) {
                    case 'negotiate':
                    case 'offer_mercy':
                        npc.disposition = 'neutral';
                        if (approach === 'offer_mercy') npc.memory.wasSpared = true;
                        break;
                    case 'intimidate':
                        npc.disposition = 'fearful';
                        break;
                    case 'recruit':
                        npc.disposition = 'friendly';
                        npc.isAlly = true;
                        state.npcAllies.add(npc.id);
                        break;
                    case 'trade':
                        break;
                    case 'ask_info':
                        break;
                }

                if (npc.disposition !== prevDisposition) {
                    npc.memory.dispositionHistory.push({
                        turn: state.turnCount,
                        from: prevDisposition,
                        to: npc.disposition,
                        reason: `Player ${approach} (${args.tone})`,
                    });
                }

                return JSON.stringify({
                    success: true,
                    approach,
                    npc_id: npc.id,
                    npc_name: npc.name,
                    old_disposition: prevDisposition,
                    new_disposition: npc.disposition,
                    roll,
                    chance,
                    is_ally: npc.isAlly,
                });
            }

            return JSON.stringify({
                success: false,
                approach,
                npc_id: npc.id,
                npc_name: npc.name,
                disposition: npc.disposition,
                roll,
                chance,
            });
        },
    });

    const recordMoralChoice = tool({
        name: 'record_moral_choice',
        description: 'Record a significant moral choice the player made. Call this when the player spares an enemy, sacrifices resources, ignores a plea for help, or makes any morally significant decision.',
        parameters: z.object({
            description: z.string().describe('What the player chose to do'),
            tendency: z.enum(['mercy', 'sacrifice', 'pragmatic']).describe('Which moral tendency this represents'),
            magnitude: z.number().describe('How significant (1-3): 1=minor, 2=moderate, 3=major'),
        }),
        execute: (args: { description: string; tendency: 'mercy' | 'sacrifice' | 'pragmatic'; magnitude: number }, ctx?: RunContext<GameContext>) => {
            const { state } = getCtx(ctx);
            const magnitude = Math.max(1, Math.min(3, args.magnitude));

            state.moralProfile.choices.push({
                turn: state.turnCount,
                description: args.description,
                tendency: args.tendency,
                magnitude,
            });
            state.moralProfile.tendencies[args.tendency] += magnitude;

            return JSON.stringify({ recorded: true, tendency: args.tendency, total: state.moralProfile.tendencies[args.tendency] });
        },
    });

    const suggestActions = defineSuggestTool(
        'suggest_actions',
        'Present 3-5 contextual creative actions the player can attempt in the current situation. Use for non-combat situations. Actions are displayed as interactive UI buttons.',
        'What Do You Do?',
        'actions',
        '3-5 contextual creative actions',
        'Action options displayed as interactive UI buttons. Do NOT list them in text.',
    );

    const suggestInteractions = defineSuggestTool(
        'suggest_interactions',
        'Present 3-5 contextual NPC interaction approaches. Call BEFORE interact_npc when player wants to interact but hasn\'t specified an approach.',
        'How Do You Approach?',
        'interactions',
        '3-5 contextual NPC interaction approaches',
        'Interaction options displayed as interactive UI buttons. Do NOT list them in text. Write one brief line, then STOP and wait.',
    );

    const completeObjective = tool({
        name: 'complete_objective',
        description: 'Mark the current objective step as complete when the player performs the required action in the correct room.',
        parameters: z.object({
            step_description: z.string().describe('Description of what was accomplished'),
        }),
        execute: (args: { step_description: string }, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            const objectives = station.objectives;
            if (objectives.currentStepIndex >= objectives.steps.length) {
                return JSON.stringify({ error: 'No more objectives.' });
            }
            const currentStep = objectives.steps[objectives.currentStepIndex];

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
            objectives.currentStepIndex++;

            if (objectives.currentStepIndex >= objectives.steps.length) {
                objectives.completed = true;
                return JSON.stringify({
                    success: true,
                    description: args.step_description,
                    all_complete: true,
                    escape_room: station.rooms.get(station.escapeRoomId)?.name ?? 'escape',
                });
            }

            const next = objectives.steps[objectives.currentStepIndex];
            return JSON.stringify({
                success: true,
                description: args.step_description,
                all_complete: false,
                next_objective: next.description,
                next_room: station.rooms.get(next.roomId)?.name ?? next.roomId,
            });
        },
    });

    // ─── Engineering Tools ─────────────────────────────────────────────────

    const diagnoseSystem = tool({
        name: 'diagnose_system',
        description: 'Scan a failing system in the current room to determine root cause, required materials, and repair difficulty. Transitions system from detected → characterized.',
        parameters: z.object({
            system: z.string().describe('System ID to diagnose (e.g. "coolant_loop", "power_relay")'),
        }),
        execute: (args: { system: string }, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

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
                success: true,
                system_id: failure.systemId,
                failure_mode: failure.failureMode,
                severity: failure.severity,
                status: failure.status,
                required_materials: failure.requiredMaterials,
                required_skill: failure.requiredSkill,
                difficulty: failure.difficulty,
                diagnosis_hint: failure.diagnosisHint,
                cascade_timer: failure.turnsUntilCascade > 0 ? failure.turnsUntilCascade : null,
                cascade_target: failure.cascadeTarget,
                hazard_per_turn: failure.hazardPerTurn,
                mitigation_paths: failure.mitigationPaths,
            });
        },
    });

    const stabilizeHazard = tool({
        name: 'stabilize_hazard',
        description: 'Apply temporary mitigation to a diagnosed system failure. Buys time by doubling the cascade timer but does not fix the root cause. Easier than full repair.',
        parameters: z.object({
            system: z.string().describe('System ID to stabilize'),
            method: z.string().describe('How you are stabilizing it'),
        }),
        execute: (args: { system: string; method: string }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const failure = room.systemFailures.find(f => f.systemId === args.system && f.challengeState === 'characterized');
            if (!failure) return JSON.stringify({ error: `No characterized ${args.system} failure to stabilize. Diagnose it first.` });

            const target = Math.max(5, Math.min(98,
                (failure.severity === 1 ? 85 : failure.severity === 2 ? 65 : 45)
                + getProficiencyModifier(build, failure.requiredSkill)
            ));
            const roll = randInt(1, 100);

            if (roll <= target) {
                failure.challengeState = 'stabilized';
                failure.turnsUntilCascade *= 2;
                failure.status = 'degraded';
                return JSON.stringify({
                    success: true, system_id: failure.systemId, method: args.method,
                    roll, target, new_cascade_timer: failure.turnsUntilCascade,
                });
            }

            return JSON.stringify({ success: false, system_id: failure.systemId, method: args.method, roll, target });
        },
    });

    const repairSystem = tool({
        name: 'repair_system',
        description: 'Perform a full repair on a diagnosed or stabilized system failure. Requires correct materials (consumed) and a skill check. Tools are reusable.',
        parameters: z.object({
            system: z.string().describe('System ID to repair'),
            materials_used: z.array(z.string()).describe('Names of materials from inventory to use'),
        }),
        execute: (args: { system: string; materials_used: string[] }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
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

            // Check required materials are in inventory
            const missing: string[] = [];
            for (const mat of failure.requiredMaterials) {
                const found = state.inventory.some(id =>
                    id === mat || station.items.get(id)?.name.toLowerCase() === mat.replace(/_/g, ' ')
                );
                if (!found) missing.push(mat);
            }
            if (missing.length > 0) {
                return JSON.stringify({ error: 'Missing required materials.', missing, required: failure.requiredMaterials });
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
                return JSON.stringify({
                    success: true, outcome, system_id: failure.systemId, roll, target,
                    inventory: state.inventory.map(id => getItemName(id, station)),
                });
            }
            if (outcome === 'partial_success') {
                if (failure.challengeState !== 'stabilized') {
                    failure.challengeState = 'stabilized';
                    failure.turnsUntilCascade += 3;
                }
                return JSON.stringify({
                    success: false, partial: true, outcome, system_id: failure.systemId, roll, target,
                    note: 'Repair incomplete but system stabilized.',
                    inventory: state.inventory.map(id => getItemName(id, station)),
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
                inventory: state.inventory.map(id => getItemName(id, station)),
            });
        },
    });

    const improviseRepair = tool({
        name: 'improvise_repair',
        description: '"Science the hell out of it" — fix a system failure with non-standard materials and creative reasoning. Higher difficulty but always possible.',
        parameters: z.object({
            system: z.string().describe('System ID to repair'),
            approach: z.string().describe('How you plan to improvise the repair'),
            materials_used: z.array(z.string()).describe('Non-standard materials you are using'),
        }),
        execute: (args: { system: string; approach: string; materials_used: string[] }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

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
                return JSON.stringify({ error: 'You need at least one material from your inventory.' });
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
                return JSON.stringify({
                    success: true, system_id: failure.systemId, approach: args.approach,
                    roll, target, improvised: true,
                    inventory: state.inventory.map(id => getItemName(id, station)),
                });
            }

            return JSON.stringify({
                success: false, system_id: failure.systemId, approach: args.approach, roll, target,
                inventory: state.inventory.map(id => getItemName(id, station)),
            });
        },
    });

    const craftItem = tool({
        name: 'craft_item',
        description: 'Combine inventory materials to create a new component. Uses known recipes. Consumes ingredients on success.',
        parameters: z.object({
            ingredients: z.array(z.string()).describe('Names of materials to combine'),
            intended_result: z.string().describe('What you are trying to create'),
        }),
        execute: (args: { ingredients: string[]; intended_result: string }, ctx?: RunContext<GameContext>) => {
            const { state, station, build } = getCtx(ctx);
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

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

            return JSON.stringify({
                success: true, crafted: recipe.resultName, roll, target,
                inventory: state.inventory.map(id => getItemName(id, station)),
            });
        },
    });

    const analyzeItem = tool({
        name: 'analyze_item',
        description: 'Examine an inventory item to understand its properties, repair applications, and combination potential.',
        parameters: z.object({
            item: z.string().describe('Name of the item to analyze'),
        }),
        execute: (args: { item: string }, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            const itemName = args.item.toLowerCase();

            let itemId: string | null = null;
            for (const id of state.inventory) {
                const item = station.items.get(id);
                if (id.toLowerCase() === itemName || item?.name.toLowerCase() === itemName) {
                    itemId = id;
                    break;
                }
            }
            if (!itemId) return JSON.stringify({ error: `"${args.item}" not in inventory.` });

            const item = station.items.get(itemId);
            if (!item) return JSON.stringify({ error: 'Item data missing.' });

            const recipes = CRAFT_RECIPES.filter(r => r.ingredients.includes(itemId));
            const room = station.rooms.get(state.currentRoom);
            const applicableFailures = room?.systemFailures
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
        name: 'check_environment',
        description: 'Read environmental sensors in the current room: atmosphere composition, pressure, temperature, radiation, structural data, and derived physics (partial pressures, boiling points, dose equivalents). Returns raw numbers plus computed values for engineering assessment.',
        parameters: z.object({}),
        execute: (_args, ctx?: RunContext<GameContext>) => {
            const { state, station } = getCtx(ctx);
            const room = station.rooms.get(state.currentRoom);
            if (!room) return JSON.stringify({ error: 'Invalid room.' });

            const env = computeEnvironment(room, state.activeEvents);
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
        'suggest_diagnostics',
        'Present 3-5 contextual engineering diagnostic actions. Call when the player wants to investigate or repair systems but hasn\'t specified a specific action.',
        'Engineering Assessment',
        'diagnostics',
        '3-5 contextual engineering actions',
        'Diagnostic options displayed as interactive UI buttons. Focus on engineering: characterize failures, check sensors, analyze components. Do NOT list in text.',
    );

    // ─── Class-Specific Tools ───────────────────────────────────────────────

    let bypassSystem: Tool<GameContext> | null = null;
    let fieldSurgery: Tool<GameContext> | null = null;
    let crisisAssessment: Tool<GameContext> | null = null;

    if (classId === 'engineer') {
        bypassSystem = tool({
            name: 'bypass_system',
            description: 'Bypass a locked door without a keycard, repair severity-1 failures without materials, or reveal secret passages. Engineer class ability. Requires multitool.',
            parameters: z.object({
                target: z.string().describe('What to bypass or repair'),
            }),
            execute: (args: { target: string }, ctx?: RunContext<GameContext>) => {
                const { state, station } = getCtx(ctx);
                if (!state.inventory.some(id => id === 'multitool' || station.items.get(id)?.name.toLowerCase().includes('multitool'))) {
                    return JSON.stringify({ error: 'You need a multitool for this.' });
                }

                // Check for severity-1 system failures to auto-repair
                const room = station.rooms.get(state.currentRoom);
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
        }) as Tool<GameContext>;
    }

    if (classId === 'medic') {
        fieldSurgery = tool({
            name: 'field_surgery',
            description: 'Heal 15 HP using medical expertise. Usable once per room. Medic class ability.',
            parameters: z.object({}),
            execute: (_args, ctx?: RunContext<GameContext>) => {
                const { state } = getCtx(ctx);
                if (state.fieldSurgeryUsedInRoom.has(state.currentRoom)) {
                    return JSON.stringify({ error: 'You already performed field surgery in this room.' });
                }
                const healed = Math.min(15, state.maxHp - state.hp);
                state.hp += healed;
                state.metrics.totalDamageHealed += healed;
                state.fieldSurgeryUsedInRoom.add(state.currentRoom);
                return JSON.stringify({ success: true, healed, player_hp: state.hp, player_maxHp: state.maxHp });
            },
        }) as Tool<GameContext>;
    }

    if (classId === 'commander') {
        crisisAssessment = tool({
            name: 'crisis_assessment',
            description: 'Reveal cascade timers and failure states in all adjacent rooms. Commander class ability.',
            parameters: z.object({}),
            execute: (_args, ctx?: RunContext<GameContext>) => {
                const { state, station } = getCtx(ctx);
                const adjacent = getAdjacentRooms(state, station);
                const assessments = adjacent.map(id => {
                    const room = station.rooms.get(id);
                    if (!room) return { room_id: id, failures: [] };
                    return {
                        room_name: room.name,
                        failures: room.systemFailures
                            .filter(f => f.challengeState !== 'resolved')
                            .map(f => ({
                                system_id: f.systemId,
                                severity: f.severity,
                                state: f.challengeState,
                                cascade_timer: f.turnsUntilCascade > 0 ? f.turnsUntilCascade : null,
                                cascade_target: f.cascadeTarget,
                            })),
                    };
                });
                return JSON.stringify({ success: true, adjacent_assessments: assessments });
            },
        }) as Tool<GameContext>;
    }

    // ─── Assemble Tool Sets ─────────────────────────────────────────────────

    const all: Tool<GameContext>[] = [
        lookAround, moveTo, pickUpItem, useItem,
        diagnoseSystem, stabilizeHazard, repairSystem, improviseRepair,
        craftItem, analyzeItem, checkEnvironment,
        suggestDiagnostics, suggestActions, suggestInteractions,
        attemptAction, interactNPC, recordMoralChoice, completeObjective,
    ];
    if (bypassSystem) all.push(bypassSystem);
    if (fieldSurgery) all.push(fieldSurgery);
    if (crisisAssessment) all.push(crisisAssessment);

    const engineering: Tool<GameContext>[] = [
        diagnoseSystem, stabilizeHazard, repairSystem, improviseRepair,
        craftItem, attemptAction, suggestDiagnostics, useItem,
    ];
    if (bypassSystem) engineering.push(bypassSystem);

    const diagnostics: Tool<GameContext>[] = [
        checkEnvironment, analyzeItem, lookAround, suggestDiagnostics, useItem,
    ];

    const exploration: Tool<GameContext>[] = [
        lookAround, moveTo, pickUpItem, attemptAction,
        suggestActions, completeObjective,
    ];
    if (fieldSurgery) exploration.push(fieldSurgery);
    if (bypassSystem) exploration.push(bypassSystem);
    if (crisisAssessment) exploration.push(crisisAssessment);

    return { all, engineering, diagnostics, exploration };
}

// ─── Tone Matching ──────────────────────────────────────────────────────────

function getToneBonus(tone: string, approach: string, disposition: Disposition): number {
    // Good matches
    if (tone === 'empathetic' && approach === 'offer_mercy') return 15;
    if (tone === 'calm' && approach === 'negotiate') return 10;
    if (tone === 'commanding' && approach === 'intimidate' && disposition === 'fearful') return 15;
    if (tone === 'empathetic' && approach === 'recruit') return 10;
    if (tone === 'calm' && approach === 'trade') return 5;

    // Bad matches
    if (tone === 'aggressive' && approach === 'offer_mercy') return -10;
    if (tone === 'desperate' && approach === 'intimidate') return -10;
    if (tone === 'aggressive' && approach === 'negotiate' && disposition === 'fearful') return -5;

    return 0;
}
