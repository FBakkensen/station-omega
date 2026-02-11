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
    return [...station.npcs.values()].filter(npc => npc.roomId === roomId && npc.disposition !== 'dead');
}

function getRoomThreat(roomId: string, station: GeneratedStation): NPC | null {
    const room = station.rooms.get(roomId);
    if (!room?.threat) return null;
    const npc = station.npcs.get(room.threat);
    if (!npc || npc.disposition === 'dead') return null;
    return npc;
}

function getItemName(itemId: string, station: GeneratedStation): string {
    return station.items.get(itemId)?.name ?? itemId;
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

export type CombatStartCallback = () => void;

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
    onCombatStart: CombatStartCallback;
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
    combat: Tool<GameContext>[];        // attack, suggest_attacks, use_item, [tactical_scan]
    dialogue: Tool<GameContext>[];      // interact_npc, suggest_interactions, record_moral_choice, use_item
    exploration: Tool<GameContext>[];   // look_around, move_to, pick_up_item, attempt_action,
                                        // suggest_actions, complete_objective, field_surgery,
                                        // [bypass_system], [system_hack]
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
            const drop = state.roomDrops.get(state.currentRoom) ?? null;

            // Reveal items so pick_up_item can validate discovery
            if (lootPresent && room.loot) state.revealedItems.add(room.loot);
            if (drop) state.revealedItems.add(drop);

            const threat = getRoomThreat(state.currentRoom, station);
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
                drop_visible: drop ? getItemName(drop, station) : null,
                threat: threat
                    ? { name: threat.name, demeanor: threat.disposition, appearance: threat.appearance }
                    : null,
                npcs_present: getNPCsInRoom(state.currentRoom, station).map(npc => ({
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
                    enemy_defeated_here: room.threat !== null && getRoomThreat(state.currentRoom, station) === null,
                    loot_taken_here: state.roomLootTaken.has(state.currentRoom),
                },
                objective_hint: isObjectiveHere ? currentStep.description : null,
                active_events: state.activeEvents.map(e => ({ type: e.type, effect: e.effect, turns_remaining: e.turnsRemaining })),
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
            const threat = getRoomThreat(targetId, station);

            // Reveal items on room entry
            const lootPresent = room?.loot && !state.roomLootTaken.has(targetId);
            const drop = state.roomDrops.get(targetId) ?? null;
            if (lootPresent && room.loot) state.revealedItems.add(room.loot);
            if (drop) state.revealedItems.add(drop);

            return JSON.stringify({
                success: true,
                room_name: room?.name ?? targetId,
                room_index: `${String([...station.rooms.keys()].indexOf(targetId) + 1)} of ${String(station.rooms.size)}`,
                description: room?.descriptionSeed ?? '',
                threat_present: threat ? threat.name : null,
                item_visible: lootPresent && room.loot ? getItemName(room.loot, station) : null,
                drop_visible: drop ? getItemName(drop, station) : null,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                sensory: room?.sensory ?? null,
                is_revisit: (state.roomVisitCount.get(targetId) ?? 0) > 1,
                enemy_defeated_here: room?.threat !== null && getRoomThreat(targetId, station) === null,
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

            // Threat blocks pickup
            const threat = getRoomThreat(state.currentRoom, station);
            if (threat) {
                return JSON.stringify({ success: false, reason: 'threat_blocking', threat_name: threat.name });
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

            // Check enemy drop
            const drop = state.roomDrops.get(state.currentRoom);
            if (drop && (drop === itemId || station.items.get(drop)?.name.toLowerCase() === itemName)) {
                if (!state.revealedItems.has(drop)) {
                    return JSON.stringify({ success: false, reason: 'not_revealed' });
                }
                state.roomDrops.delete(state.currentRoom);
                state.inventory.push(drop);
                state.metrics.itemsCollected.push(drop);
                return JSON.stringify({
                    success: true,
                    item_id: drop,
                    item_name: getItemName(drop, station),
                    inventory: state.inventory.map(id => getItemName(id, station)),
                    slots_remaining: state.maxInventory - state.inventory.length,
                });
            }

            if (!roomLootAvailable && !drop) {
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

            state.inventory.splice(foundIdx, 1);
            state.metrics.itemsUsed.push(foundId);

            switch (item.effect.type) {
                case 'heal': {
                    const healAmount = build.id === 'medic' ? item.effect.value * 2 : item.effect.value;
                    const healed = Math.min(healAmount, state.maxHp - state.hp);
                    state.hp += healed;
                    state.metrics.totalDamageHealed += healed;
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'heal', healed, player_hp: state.hp, player_maxHp: state.maxHp });
                }
                case 'damage_boost': {
                    state.plasmaBoost = true;
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'damage_boost', bonus: item.effect.value });
                }
                case 'shield': {
                    state.shieldActive = true;
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: 'shield', absorb: item.effect.value });
                }
                default:
                    return JSON.stringify({ success: true, item_name: item.name, effect_type: item.effect.type });
            }
        },
    });

    const attackTool = tool({
        name: 'attack',
        description: 'Attack the enemy in the current room with the player\'s chosen approach. Only call this AFTER the player has chosen or described their approach.',
        parameters: z.object({
            approach: z.string().describe('How you attack — your strategy or action'),
        }),
        execute: (args: { approach: string }, ctx?: RunContext<GameContext>) => {
            const gameCtx = getCtx(ctx);
            const { state, station, build } = gameCtx;
            if (state.gameOver) return JSON.stringify({ error: 'The game is over.' });

            const npc = getRoomThreat(state.currentRoom, station);
            if (!npc) return JSON.stringify({ error: 'There is no enemy to fight here.' });

            gameCtx.onCombatStart();

            // Player attacks
            let playerDamage = randInt(build.baseDamage[0], build.baseDamage[1]);
            if (state.plasmaBoost) {
                playerDamage += 25;
                state.plasmaBoost = false;
            }
            if (state.activeEvents.some(e => e.type === 'radiation_spike')) {
                playerDamage = Math.max(1, Math.floor(playerDamage * 0.75));
            }
            npc.currentHp -= playerDamage;
            state.metrics.totalDamageDealt += playerDamage;

            // Enemy attacks back (if alive)
            let enemyDamage = 0;
            let shieldAbsorbed = 0;
            if (npc.currentHp > 0) {
                enemyDamage = randInt(npc.damage[0], npc.damage[1]);
                if (state.shieldActive) {
                    shieldAbsorbed = Math.min(20, enemyDamage);
                    enemyDamage -= shieldAbsorbed;
                    state.shieldActive = false;
                }
                state.hp -= enemyDamage;
                state.metrics.totalDamageTaken += enemyDamage;
            }

            const defeated = npc.currentHp <= 0;
            if (defeated) {
                npc.currentHp = 0;
                npc.disposition = 'dead';
                state.metrics.enemiesDefeated.push(npc.id);
            }

            // NPC flee check
            let fled = false;
            if (!defeated && npc.currentHp > 0 && npc.behaviors.has('can_flee')) {
                const hpPct = npc.currentHp / npc.maxHp;
                if (hpPct <= npc.fleeThreshold) {
                    fled = true;
                    npc.memory.hasFled = true;
                    const room = station.rooms.get(state.currentRoom);
                    const fleeTargets = room?.connections.filter(id => id !== state.currentRoom) ?? [];
                    if (fleeTargets.length > 0) {
                        const fleeTarget = fleeTargets[randInt(0, fleeTargets.length - 1)];
                        npc.roomId = fleeTarget;
                        npc.memory.fledTo = fleeTarget;
                        if (room) room.threat = null;
                    }
                }
            }

            // Player death
            if (state.hp <= 0) {
                state.hp = 0;
                state.gameOver = true;
                state.metrics.deathCause = `Killed by ${npc.name}`;
                return JSON.stringify({
                    approach: args.approach,
                    player_damage_dealt: playerDamage,
                    enemy_name: npc.name,
                    enemy_damage_dealt: enemyDamage,
                    shield_absorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
                    enemy_defeated: defeated,
                    player_died: true,
                    game_over: true,
                });
            }

            const result: Record<string, unknown> = {
                approach: args.approach,
                player_damage_dealt: playerDamage,
                enemy_name: npc.name,
                enemy_damage_dealt: enemyDamage,
                shield_absorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
                enemy_defeated: defeated,
                enemy_remaining_hp: defeated ? 0 : npc.currentHp,
                player_hp: state.hp,
                player_maxHp: state.maxHp,
                enemy_fled: fled,
            };

            if (defeated && npc.drop) {
                result.loot_dropped = getItemName(npc.drop, station);
                state.roomDrops.set(state.currentRoom, npc.drop);
                state.revealedItems.add(npc.drop);
            }

            return JSON.stringify(result);
        },
    });

    const suggestAttacks = defineSuggestTool(
        'suggest_attacks',
        'Present the player with 3-5 contextual attack approaches to choose from. Call this BEFORE calling attack, when the player wants to fight but hasn\'t described a specific approach.',
        'Choose Your Attack',
        'approaches',
        '3-5 contextual attack approaches',
        'Attack options displayed as interactive UI buttons. Do NOT list them in text. Write one atmospheric line, then STOP and wait.',
    );

    // ─── New Tools ──────────────────────────────────────────────────────────

    const attemptAction = tool({
        name: 'attempt_action',
        description: 'Resolve a creative player action through dice roll. The AI assesses domain and difficulty; the game engine resolves outcome. Use for any non-standard action (barricading, hacking, improvising, etc.).',
        parameters: z.object({
            action: z.string().describe('What the player is attempting'),
            domain: z.enum(['combat', 'tech', 'medical', 'social', 'survival', 'science']).describe('The skill domain'),
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
            if (npc.disposition === 'dead') return JSON.stringify({ error: `${npc.name} is already dead.` });

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
            const BASE: Record<Disposition, number> = { hostile: 30, neutral: 60, friendly: 85, fearful: 75, dead: 0 };
            let chance = BASE[npc.disposition];

            // Social proficiency
            const socialMod = getProficiencyModifier(build, 'social');
            chance += socialMod;

            // Tone matching bonus
            const toneBonus = getToneBonus(args.tone, approach, npc.disposition);
            chance += toneBonus;

            // Wound bonus (wounded NPCs easier to influence)
            const npcHpPct = npc.currentHp / npc.maxHp;
            if (npcHpPct < 0.5) chance += 20;
            else if (npcHpPct < 0.75) chance += 10;

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

                // Clear threat if NPC was hostile and is now neutral/friendly
                if (prevDisposition === 'hostile' && npc.disposition !== 'hostile') {
                    const room = station.rooms.get(state.currentRoom);
                    if (room?.threat === npc.id) {
                        room.threat = null;
                    }
                }

                return JSON.stringify({
                    success: true,
                    approach,
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
        'Interaction options displayed as interactive UI buttons. Do NOT list them in text. Write one atmospheric line, then STOP and wait.',
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

    // ─── Class-Specific Tools ───────────────────────────────────────────────

    let tacticalScan: Tool<GameContext> | null = null;
    let bypassSystem: Tool<GameContext> | null = null;
    let fieldSurgery: Tool<GameContext> | null = null;
    let systemHack: Tool<GameContext> | null = null;

    if (classId === 'soldier') {
        tacticalScan = tool({
            name: 'tactical_scan',
            description: 'Reveal enemy stats and weaknesses before combat. Soldier class ability.',
            parameters: z.object({}),
            execute: (_args, ctx?: RunContext<GameContext>) => {
                const { state, station } = getCtx(ctx);
                const threat = getRoomThreat(state.currentRoom, station);
                if (!threat) return JSON.stringify({ error: 'No enemy to scan.' });
                return JSON.stringify({
                    name: threat.name,
                    hp: `${String(threat.currentHp)}/${String(threat.maxHp)}`,
                    damage_range: `${String(threat.damage[0])}-${String(threat.damage[1])}`,
                    behaviors: [...threat.behaviors],
                    flee_threshold: threat.fleeThreshold > 0 ? `Will flee below ${String(Math.round(threat.fleeThreshold * 100))}% HP` : 'Will not flee',
                    personality: threat.personality,
                });
            },
        }) as Tool<GameContext>;
    }

    if (classId === 'engineer') {
        bypassSystem = tool({
            name: 'bypass_system',
            description: 'Bypass a locked door without a keycard, or repair a system. Engineer class ability. Requires multitool in inventory.',
            parameters: z.object({
                target: z.string().describe('What to bypass or repair'),
            }),
            execute: (args: { target: string }, ctx?: RunContext<GameContext>) => {
                const { state, station } = getCtx(ctx);
                if (!state.inventory.some(id => id === 'multitool' || station.items.get(id)?.name.toLowerCase().includes('multitool'))) {
                    return JSON.stringify({ error: 'You need a multitool for this.' });
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

                // Check for secret connections to reveal
                const room = station.rooms.get(state.currentRoom);
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

    if (classId === 'hacker') {
        systemHack = tool({
            name: 'system_hack',
            description: 'Hack station systems: reveal all crew logs in current room, disable enemy buffs, or reveal the station map. Hacker class ability. Requires data_spike in inventory.',
            parameters: z.object({
                target: z.enum(['crew_logs', 'enemy_debuff', 'reveal_map', 'secret_passage']).describe('What to hack'),
            }),
            execute: (args: { target: string }, ctx?: RunContext<GameContext>) => {
                const { state, station } = getCtx(ctx);
                if (!state.inventory.some(id => id === 'data_spike' || station.items.get(id)?.name.toLowerCase().includes('data spike'))) {
                    return JSON.stringify({ error: 'You need a data spike for this.' });
                }

                switch (args.target) {
                    case 'crew_logs': {
                        const room = station.rooms.get(state.currentRoom);
                        if (!room) return JSON.stringify({ error: 'Invalid room.' });
                        state.metrics.crewLogsFound += room.crewLogs.length;
                        return JSON.stringify({ success: true, hack_type: 'crew_logs', logs: room.crewLogs });
                    }
                    case 'enemy_debuff': {
                        const threat = getRoomThreat(state.currentRoom, station);
                        if (!threat) return JSON.stringify({ error: 'No enemy to debuff.' });
                        threat.damage = [Math.floor(threat.damage[0] * 0.7), Math.floor(threat.damage[1] * 0.7)];
                        return JSON.stringify({ success: true, hack_type: 'enemy_debuff', target_name: threat.name, new_damage: threat.damage });
                    }
                    case 'reveal_map': {
                        const mapData = [...station.rooms.entries()].map(([id, r]) => ({
                            name: r.name,
                            visited: state.roomsVisited.has(id),
                            has_threat: r.threat !== null && getRoomThreat(id, station) !== null,
                            has_loot: r.loot !== null && !state.roomLootTaken.has(id),
                        }));
                        return JSON.stringify({ success: true, hack_type: 'reveal_map', map: mapData });
                    }
                    case 'secret_passage': {
                        const room = station.rooms.get(state.currentRoom);
                        if (!room?.secretConnection) return JSON.stringify({ error: 'No hidden passages detected.' });
                        const secretRoom = station.rooms.get(room.secretConnection);
                        if (secretRoom && !room.connections.includes(room.secretConnection)) {
                            room.connections.push(room.secretConnection);
                            secretRoom.connections.push(state.currentRoom);
                            return JSON.stringify({ success: true, hack_type: 'secret_passage', target_room: secretRoom.name });
                        }
                        return JSON.stringify({ error: 'Passage already revealed.' });
                    }
                    default:
                        return JSON.stringify({ error: `Unknown hack target: ${args.target}` });
                }
            },
        }) as Tool<GameContext>;
    }

    // ─── Assemble Tool Sets ─────────────────────────────────────────────────

    const all: Tool<GameContext>[] = [
        lookAround, moveTo, pickUpItem, useItem, attackTool,
        suggestAttacks, attemptAction, interactNPC, suggestInteractions,
        recordMoralChoice, suggestActions, completeObjective,
    ];
    if (tacticalScan) all.push(tacticalScan);
    if (bypassSystem) all.push(bypassSystem);
    if (fieldSurgery) all.push(fieldSurgery);
    if (systemHack) all.push(systemHack);

    const combat: Tool<GameContext>[] = [attackTool, suggestAttacks, useItem];
    if (tacticalScan) combat.push(tacticalScan);

    const dialogue: Tool<GameContext>[] = [interactNPC, suggestInteractions, recordMoralChoice, useItem];

    const exploration: Tool<GameContext>[] = [
        lookAround, moveTo, pickUpItem, attemptAction,
        suggestActions, completeObjective,
    ];
    if (fieldSurgery) exploration.push(fieldSurgery);
    if (bypassSystem) exploration.push(bypassSystem);
    if (systemHack) exploration.push(systemHack);

    return { all, combat, dialogue, exploration };
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
