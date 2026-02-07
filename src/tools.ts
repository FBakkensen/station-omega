import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
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

function hpDescription(state: GameState): string {
    const pct = state.hp / state.maxHp;
    if (pct >= 0.8) return 'You feel strong and healthy.';
    if (pct >= 0.5) return 'You have some cuts and bruises, but you can push on.';
    if (pct >= 0.25) return 'You\'re badly wounded. Blood drips from several gashes.';
    return 'You\'re barely standing. Vision blurring. Every breath hurts.';
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

// ─── Tool Factory ───────────────────────────────────────────────────────────

export interface ToolContext {
    state: GameState;
    station: GeneratedStation;
    build: CharacterBuild;
    onCombatStart: CombatStartCallback | null;
    onChoices: ChoicesCallback | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool array requires 'any' for variance compatibility with mixed parameter types
export function createGameTools(ctx: ToolContext): Tool<any>[] {
    const { state, station, build } = ctx;

    function defineSuggestTool(
        name: string, description: string, title: string,
        fieldName: string, fieldDesc: string, note: string,
    ) {
        return defineTool(name, {
            description,
            parameters: {
                type: 'object',
                properties: {
                    [fieldName]: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'Short punchy name (2-6 words)' },
                                description: { type: 'string', description: 'One-sentence evocative description' },
                            },
                            required: ['label', 'description'],
                        },
                        description: fieldDesc,
                    },
                },
                required: [fieldName],
            },
            handler: (args: Record<string, { label: string; description: string }[]>) => {
                ctx.onChoices?.({ title, choices: args[fieldName] });
                return { presented: true, note };
            },
        });
    }

    const lookAround = defineTool('look_around', {
        description: 'Look around the current room. Returns details about the environment, items, threats, and exits.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => {
            const room = station.rooms.get(state.currentRoom);
            if (!room) return { error: 'Invalid room.' };

            const lootPresent = room.loot && !state.roomLootTaken.has(state.currentRoom);
            const drop = state.roomDrops.get(state.currentRoom) ?? null;
            const threat = getRoomThreat(state.currentRoom, station);
            const exits = getAdjacentRooms(state, station).map(id => {
                const r = station.rooms.get(id);
                return r ? r.name : id;
            });

            const objectives = station.objectives;
            const currentStep = objectives.steps[objectives.currentStepIndex] as typeof objectives.steps[number] | undefined;
            const isObjectiveHere = currentStep !== undefined && currentStep.roomId === state.currentRoom && !currentStep.completed;

            return {
                room_name: room.name,
                room_index: `${String([...station.rooms.keys()].indexOf(state.currentRoom) + 1)} of ${String(station.rooms.size)}`,
                description: room.descriptionSeed,
                item_visible: lootPresent && room.loot ? getItemName(room.loot, station) : null,
                drop_visible: drop ? getItemName(drop, station) : null,
                threat: threat ? { name: threat.name, demeanor: threat.disposition, appearance: threat.appearance } : null,
                npcs_present: getNPCsInRoom(state.currentRoom, station).map(npc => ({
                    name: npc.name,
                    disposition: npc.disposition,
                    is_ally: npc.isAlly,
                })),
                exits,
                player_condition: hpDescription(state),
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
            };
        },
    });

    const moveTo = defineTool('move_to', {
        description: 'Move to an adjacent room by name. Use the room names from look_around exits.',
        parameters: {
            type: 'object',
            properties: {
                room: { type: 'string', description: 'Name of the room to move to' },
            },
            required: ['room'],
        },
        handler: (args: { room: string }) => {
            if (state.gameOver) return { error: 'The game is over.' };

            // Find room by name
            let targetId: string | null = null;
            for (const [id, r] of station.rooms) {
                if (r.name.toLowerCase() === args.room.toLowerCase()) {
                    targetId = id;
                    break;
                }
            }
            if (!targetId) return { error: `Unknown room: "${args.room}".` };

            const adjacent = getAdjacentRooms(state, station);
            if (!adjacent.includes(targetId)) {
                const targetRoom = station.rooms.get(targetId);
                return { error: `You can't reach ${targetRoom?.name ?? args.room} from here. Check available exits.` };
            }

            // Lock check
            const targetRoom = station.rooms.get(targetId);
            if (targetRoom?.lockedBy) {
                const hasKey = state.inventory.includes(targetRoom.lockedBy);
                if (!hasKey) {
                    const keyName = getItemName(targetRoom.lockedBy, station);
                    return { error: `The door is locked. You need: ${keyName}.` };
                }
            }

            // Win condition: reaching escape room with objectives complete
            if (targetId === station.escapeRoomId && station.objectives.completed) {
                state.gameOver = true;
                state.won = true;
                state.currentRoom = targetId;
                state.metrics.won = true;
                return {
                    success: true,
                    room_name: targetRoom?.name ?? 'Escape',
                    event: 'VICTORY! You made it to the escape point. Mission complete.',
                    game_over: true,
                    won: true,
                };
            }

            state.currentRoom = targetId;
            state.roomsVisited.add(targetId);
            state.moveCount++;
            state.metrics.moveCount++;
            state.roomVisitCount.set(targetId, (state.roomVisitCount.get(targetId) ?? 0) + 1);

            const room = station.rooms.get(targetId);
            const threat = getRoomThreat(targetId, station);

            return {
                success: true,
                room_name: room?.name ?? targetId,
                room_index: `${String([...station.rooms.keys()].indexOf(targetId) + 1)} of ${String(station.rooms.size)}`,
                description: room?.descriptionSeed ?? '',
                threat_present: threat ? threat.name : null,
                player_condition: hpDescription(state),
                ambient_sound: room?.sensory.sounds[0] ?? '',
                ambient_feel: room?.sensory.tactile ?? '',
                is_revisit: (state.roomVisitCount.get(targetId) ?? 0) > 1,
                enemy_defeated_here: room?.threat !== null && getRoomThreat(targetId, station) === null,
            };
        },
    });

    const pickUpItem = defineTool('pick_up_item', {
        description: 'Pick up an item in the current room and add it to your inventory.',
        parameters: {
            type: 'object',
            properties: {
                item: { type: 'string', description: 'Name of the item to pick up' },
            },
            required: ['item'],
        },
        handler: (args: { item: string }) => {
            if (state.gameOver) return { error: 'The game is over.' };

            const room = station.rooms.get(state.currentRoom);
            if (!room) return { error: 'Invalid room.' };

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
                return { error: `The ${threat.name} is blocking the item. Deal with the threat first.` };
            }

            if (state.inventory.length >= state.maxInventory) {
                return { error: `Your inventory is full (${String(state.inventory.length)}/${String(state.maxInventory)}). Drop or use something first.` };
            }

            // Check room loot
            const roomLootAvailable = room.loot && !state.roomLootTaken.has(state.currentRoom);
            if (roomLootAvailable && room.loot && (room.loot === itemId || room.loot.toLowerCase() === itemName)) {
                const actualId = room.loot;
                state.roomLootTaken.add(state.currentRoom);
                const item = station.items.get(actualId);

                if (item?.effect.type === 'objective') {
                    state.hasObjectiveItem = true;
                    state.metrics.itemsCollected.push(actualId);
                    return {
                        success: true,
                        item: item.name,
                        message: `You pick up the ${item.name}. ${item.description}`,
                        objective: 'Continue your mission.',
                    };
                }

                state.inventory.push(actualId);
                state.metrics.itemsCollected.push(actualId);
                return {
                    success: true,
                    item: item?.name ?? actualId,
                    inventory: state.inventory.map(id => getItemName(id, station)),
                    slots_remaining: state.maxInventory - state.inventory.length,
                };
            }

            // Check enemy drop
            const drop = state.roomDrops.get(state.currentRoom);
            if (drop && (drop === itemId || station.items.get(drop)?.name.toLowerCase() === itemName)) {
                state.roomDrops.delete(state.currentRoom);
                state.inventory.push(drop);
                state.metrics.itemsCollected.push(drop);
                return {
                    success: true,
                    item: getItemName(drop, station),
                    inventory: state.inventory.map(id => getItemName(id, station)),
                    slots_remaining: state.maxInventory - state.inventory.length,
                };
            }

            if (!roomLootAvailable && !drop) {
                return { error: 'There\'s nothing left to pick up in this room.' };
            }
            return { error: `There is no "${args.item}" here.` };
        },
    });

    const useItem = defineTool('use_item', {
        description: 'Use an item from your inventory. Effects vary by item type: medical items heal, weapon items boost damage, utility items have special effects.',
        parameters: {
            type: 'object',
            properties: {
                item: { type: 'string', description: 'Name of the item to use' },
            },
            required: ['item'],
        },
        handler: (args: { item: string }) => {
            if (state.gameOver) return { error: 'The game is over.' };

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
                return { error: `You don't have "${args.item}" in your inventory.`, inventory: state.inventory.map(id => getItemName(id, station)) };
            }

            const item = station.items.get(foundId);
            if (!item) return { error: 'Item data missing.' };

            // Key items are not consumed
            if (item.isKeyItem) {
                return { success: true, item: item.name, effect: `The ${item.name} is a key item. Keep it.` };
            }

            state.inventory.splice(foundIdx, 1);
            state.metrics.itemsUsed.push(foundId);

            switch (item.effect.type) {
                case 'heal': {
                    const healAmount = build.id === 'medic' ? item.effect.value * 2 : item.effect.value;
                    const healed = Math.min(healAmount, state.maxHp - state.hp);
                    state.hp += healed;
                    state.metrics.totalDamageHealed += healed;
                    return { success: true, item: item.name, effect: `Healed ${String(healed)} HP. ${item.useNarration}`, player_condition: hpDescription(state) };
                }
                case 'damage_boost': {
                    state.plasmaBoost = true;
                    return { success: true, item: item.name, effect: `${item.useNarration} Next attack deals +${String(item.effect.value)} damage.` };
                }
                case 'shield': {
                    state.shieldActive = true;
                    return { success: true, item: item.name, effect: `${item.useNarration} Shield absorbs ${String(item.effect.value)} damage.` };
                }
                default:
                    return { success: true, item: item.name, effect: item.useNarration };
            }
        },
    });

    const attackTool = defineTool('attack', {
        description: 'Attack the enemy in the current room with the player\'s chosen approach. Only call this AFTER the player has chosen or described their approach.',
        parameters: {
            type: 'object',
            properties: {
                approach: { type: 'string', description: 'How you attack — your strategy or action' },
            },
            required: ['approach'],
        },
        handler: (args: { approach: string }) => {
            if (state.gameOver) return { error: 'The game is over.' };

            const npc = getRoomThreat(state.currentRoom, station);
            if (!npc) return { error: 'There is no enemy to fight here.' };

            ctx.onCombatStart?.();

            // Player attacks
            let playerDamage = randInt(build.baseDamage[0], build.baseDamage[1]);
            if (state.plasmaBoost) {
                playerDamage += 25;
                state.plasmaBoost = false;
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
                    // Move NPC to adjacent room
                    const room = station.rooms.get(state.currentRoom);
                    const fleeTargets = room?.connections.filter(id => id !== state.currentRoom) ?? [];
                    if (fleeTargets.length > 0) {
                        const fleeTarget = fleeTargets[randInt(0, fleeTargets.length - 1)];
                        npc.roomId = fleeTarget;
                        npc.memory.fledTo = fleeTarget;
                        // Clear threat from current room
                        if (room) room.threat = null;
                    }
                }
            }

            // Player death
            if (state.hp <= 0) {
                state.hp = 0;
                state.gameOver = true;
                state.metrics.deathCause = `Killed by ${npc.name}`;
                return {
                    approach: args.approach,
                    player_damage_dealt: playerDamage,
                    enemy_name: npc.name,
                    enemy_damage_dealt: enemyDamage,
                    shield_absorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
                    enemy_defeated: defeated,
                    player_died: true,
                    game_over: true,
                    message: 'You have been killed.',
                };
            }

            const result: Record<string, unknown> = {
                approach: args.approach,
                player_damage_dealt: playerDamage,
                enemy_name: npc.name,
                enemy_damage_dealt: enemyDamage,
                shield_absorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
                enemy_defeated: defeated,
                enemy_remaining_hp: defeated ? 0 : npc.currentHp,
                player_condition: hpDescription(state),
                enemy_fled: fled,
            };

            if (defeated && npc.drop) {
                result.loot_dropped = getItemName(npc.drop, station);
                result.loot_hint = `The ${npc.name} dropped ${getItemName(npc.drop, station)}. You can pick it up.`;
                state.roomDrops.set(state.currentRoom, npc.drop);
            }

            if (fled) {
                result.flee_message = `The ${npc.name} turns and flees deeper into the station!`;
            }

            return result;
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

    const attemptAction = defineTool('attempt_action', {
        description: 'Resolve a creative player action through dice roll. The AI assesses domain and difficulty; the game engine resolves outcome. Use for any non-standard action (barricading, hacking, improvising, etc.).',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'What the player is attempting' },
                domain: { type: 'string', enum: ['combat', 'tech', 'medical', 'social', 'survival', 'science'], description: 'The skill domain' },
                difficulty: { type: 'string', enum: ['trivial', 'easy', 'moderate', 'hard', 'extreme', 'impossible'], description: 'How hard this is' },
                relevant_items: { type: 'array', items: { type: 'string' }, description: 'Inventory items that help' },
                environmental_factors: { type: 'array', items: { type: 'string' }, description: 'Room features that help' },
            },
            required: ['action', 'domain', 'difficulty'],
        },
        handler: (args: { action: string; domain: string; difficulty: string; relevant_items?: string[]; environmental_factors?: string[] }) => {
            if (state.gameOver) return { error: 'The game is over.' };

            const domain = args.domain as ActionDomain;
            const difficulty = args.difficulty as ActionDifficulty;

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
            const itemBonus = Math.min((args.relevant_items?.length ?? 0) * 5, 15);
            if (itemBonus > 0) {
                // Verify items exist in inventory
                const validItems = (args.relevant_items ?? []).filter(name =>
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
            const envBonus = Math.min((args.environmental_factors?.length ?? 0) * 3, 9);
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

            // Add room modifier on success
            if (outcome === 'critical_success' || outcome === 'success') {
                const room = station.rooms.get(state.currentRoom);
                if (room) {
                    room.roomModifiers.push(args.action);
                }
            }

            state.metrics.creativeActionsAttempted++;

            return {
                action: args.action,
                outcome,
                roll,
                target,
                modifiers,
                damage_dealt_to_player: damageDealt > 0 ? damageDealt : undefined,
                player_condition: hpDescription(state),
                game_over: state.gameOver || undefined,
            };
        },
    });

    const interactNPC = defineTool('interact_npc', {
        description: 'Interact with an NPC non-violently. Negotiate, intimidate, trade, or recruit. Only works on NPCs with appropriate behavior flags.',
        parameters: {
            type: 'object',
            properties: {
                approach: { type: 'string', enum: ['negotiate', 'intimidate', 'offer_mercy', 'trade', 'ask_info', 'recruit'], description: 'Interaction approach' },
                target_npc: { type: 'string', description: 'Name of the NPC' },
                leverage: { type: 'string', description: 'What the player is offering or using as leverage' },
                tone: { type: 'string', enum: ['aggressive', 'calm', 'desperate', 'commanding', 'empathetic'], description: 'Tone of approach' },
            },
            required: ['approach', 'target_npc', 'tone'],
        },
        handler: (args: { approach: string; target_npc: string; leverage?: string; tone: string }) => {
            if (state.gameOver) return { error: 'The game is over.' };

            // Find NPC by name
            let npc: NPC | null = null;
            for (const n of station.npcs.values()) {
                if (n.name.toLowerCase() === args.target_npc.toLowerCase() && n.roomId === state.currentRoom) {
                    npc = n;
                    break;
                }
            }
            if (!npc) return { error: `No NPC named "${args.target_npc}" is here.` };
            if (npc.disposition === 'dead') return { error: `${npc.name} is already dead.` };

            // Check behavior compatibility
            const approach = args.approach;
            if (approach === 'negotiate' && !npc.behaviors.has('can_negotiate') && !npc.behaviors.has('is_intelligent')) {
                return { error: `${npc.name} cannot be reasoned with.` };
            }
            if (approach === 'trade' && !npc.behaviors.has('can_trade')) {
                return { error: `${npc.name} has nothing to trade.` };
            }
            if (approach === 'recruit' && !npc.behaviors.has('can_ally')) {
                return { error: `${npc.name} will not join you.` };
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
                        // Simple trade: offer leverage item
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

                return {
                    success: true,
                    approach,
                    npc_name: npc.name,
                    new_disposition: npc.disposition,
                    personality_hint: npc.personality,
                    roll,
                    chance,
                    is_ally: npc.isAlly,
                };
            }

            return {
                success: false,
                approach,
                npc_name: npc.name,
                disposition: npc.disposition,
                personality_hint: npc.personality,
                roll,
                chance,
                message: `${npc.name} rejects your ${approach}.`,
            };
        },
    });

    const recordMoralChoice = defineTool('record_moral_choice', {
        description: 'Record a significant moral choice the player made. Call this when the player spares an enemy, sacrifices resources, ignores a plea for help, or makes any morally significant decision.',
        parameters: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'What the player chose to do' },
                tendency: { type: 'string', enum: ['mercy', 'sacrifice', 'pragmatic'], description: 'Which moral tendency this represents' },
                magnitude: { type: 'number', description: 'How significant (1-3): 1=minor, 2=moderate, 3=major' },
            },
            required: ['description', 'tendency', 'magnitude'],
        },
        handler: (args: { description: string; tendency: string; magnitude: number }) => {
            const tendency = args.tendency as 'mercy' | 'sacrifice' | 'pragmatic';
            const magnitude = Math.max(1, Math.min(3, args.magnitude));

            state.moralProfile.choices.push({
                turn: state.turnCount,
                description: args.description,
                tendency,
                magnitude,
            });
            state.moralProfile.tendencies[tendency] += magnitude;

            return { recorded: true, tendency, total: state.moralProfile.tendencies[tendency] };
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

    const completeObjective = defineTool('complete_objective', {
        description: 'Mark the current objective step as complete when the player performs the required action in the correct room.',
        parameters: {
            type: 'object',
            properties: {
                step_description: { type: 'string', description: 'Description of what was accomplished' },
            },
            required: ['step_description'],
        },
        handler: (args: { step_description: string }) => {
            const objectives = station.objectives;
            if (objectives.currentStepIndex >= objectives.steps.length) {
                return { error: 'No more objectives.' };
            }
            const currentStep = objectives.steps[objectives.currentStepIndex];

            if (currentStep.roomId !== state.currentRoom) {
                return { error: 'You are not in the correct room for this objective.' };
            }

            if (currentStep.requiredItemId && !state.inventory.includes(currentStep.requiredItemId) && !state.hasObjectiveItem) {
                const itemName = getItemName(currentStep.requiredItemId, station);
                return { error: `You need the ${itemName} to complete this objective.` };
            }

            currentStep.completed = true;
            objectives.currentStepIndex++;

            if (objectives.currentStepIndex >= objectives.steps.length) {
                objectives.completed = true;
                return {
                    success: true,
                    description: args.step_description,
                    all_complete: true,
                    message: 'All objectives complete! Head to the escape point!',
                    escape_room: station.rooms.get(station.escapeRoomId)?.name ?? 'escape',
                };
            }

            const next = objectives.steps[objectives.currentStepIndex];
            return {
                success: true,
                description: args.step_description,
                all_complete: false,
                next_objective: next.description,
                next_room: station.rooms.get(next.roomId)?.name ?? next.roomId,
            };
        },
    });

    // ─── Class-Specific Tools ───────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool array requires 'any' for variance compatibility with mixed parameter types
    const tools: Tool<any>[] = [
        lookAround, moveTo, pickUpItem, useItem, attackTool,
        suggestAttacks, attemptAction, interactNPC, suggestInteractions,
        recordMoralChoice, suggestActions, completeObjective,
    ];

    if (build.id === 'soldier') {
        tools.push(defineTool('tactical_scan', {
            description: 'Reveal enemy stats and weaknesses before combat. Soldier class ability.',
            parameters: { type: 'object', properties: {}, required: [] },
            handler: () => {
                const threat = getRoomThreat(state.currentRoom, station);
                if (!threat) return { error: 'No enemy to scan.' };
                return {
                    name: threat.name,
                    hp: `${String(threat.currentHp)}/${String(threat.maxHp)}`,
                    damage_range: `${String(threat.damage[0])}-${String(threat.damage[1])}`,
                    tier: threat.tier,
                    behaviors: [...threat.behaviors],
                    flee_threshold: threat.fleeThreshold > 0 ? `Will flee below ${String(Math.round(threat.fleeThreshold * 100))}% HP` : 'Will not flee',
                    personality: threat.personality,
                };
            },
        }));
    }

    if (build.id === 'engineer') {
        tools.push(defineTool('bypass_system', {
            description: 'Bypass a locked door without a keycard, or repair a system. Engineer class ability. Requires multitool in inventory.',
            parameters: {
                type: 'object',
                properties: {
                    target: { type: 'string', description: 'What to bypass or repair' },
                },
                required: ['target'],
            },
            handler: (args: { target: string }) => {
                if (!state.inventory.some(id => id === 'multitool' || station.items.get(id)?.name.toLowerCase().includes('multitool'))) {
                    return { error: 'You need a multitool for this.' };
                }

                // Check adjacent rooms for locked doors
                const adjacent = getAdjacentRooms(state, station);
                for (const adjId of adjacent) {
                    const adjRoom = station.rooms.get(adjId);
                    if (adjRoom?.lockedBy && adjRoom.name.toLowerCase().includes(args.target.toLowerCase())) {
                        adjRoom.lockedBy = null;
                        return { success: true, message: `You bypass the lock on ${adjRoom.name}. The door hisses open.` };
                    }
                }

                // Check for secret connections to reveal
                const room = station.rooms.get(state.currentRoom);
                if (room?.secretConnection) {
                    const secretRoom = station.rooms.get(room.secretConnection);
                    if (secretRoom && !room.connections.includes(room.secretConnection)) {
                        room.connections.push(room.secretConnection);
                        secretRoom.connections.push(state.currentRoom);
                        return { success: true, message: `You discover a hidden passage to ${secretRoom.name}!` };
                    }
                }

                return { success: true, message: 'You tinker with the systems. Something clicks.' };
            },
        }));
    }

    if (build.id === 'medic') {
        tools.push(defineTool('field_surgery', {
            description: 'Heal 15 HP using medical expertise. Usable once per room. Medic class ability.',
            parameters: { type: 'object', properties: {}, required: [] },
            handler: () => {
                if (state.fieldSurgeryUsedInRoom.has(state.currentRoom)) {
                    return { error: 'You already performed field surgery in this room.' };
                }
                const healed = Math.min(15, state.maxHp - state.hp);
                state.hp += healed;
                state.metrics.totalDamageHealed += healed;
                state.fieldSurgeryUsedInRoom.add(state.currentRoom);
                return { success: true, healed, player_condition: hpDescription(state) };
            },
        }));
    }

    if (build.id === 'hacker') {
        tools.push(defineTool('system_hack', {
            description: 'Hack station systems: reveal all crew logs in current room, disable enemy buffs, or reveal the station map. Hacker class ability. Requires data_spike in inventory.',
            parameters: {
                type: 'object',
                properties: {
                    target: { type: 'string', enum: ['crew_logs', 'enemy_debuff', 'reveal_map', 'secret_passage'], description: 'What to hack' },
                },
                required: ['target'],
            },
            handler: (args: { target: string }) => {
                if (!state.inventory.some(id => id === 'data_spike' || station.items.get(id)?.name.toLowerCase().includes('data spike'))) {
                    return { error: 'You need a data spike for this.' };
                }

                switch (args.target) {
                    case 'crew_logs': {
                        const room = station.rooms.get(state.currentRoom);
                        if (!room) return { error: 'Invalid room.' };
                        state.metrics.crewLogsFound += room.crewLogs.length;
                        return { success: true, logs: room.crewLogs, message: 'All crew logs in this room decrypted.' };
                    }
                    case 'enemy_debuff': {
                        const threat = getRoomThreat(state.currentRoom, station);
                        if (!threat) return { error: 'No enemy to debuff.' };
                        threat.damage = [Math.floor(threat.damage[0] * 0.7), Math.floor(threat.damage[1] * 0.7)];
                        return { success: true, message: `${threat.name}'s combat systems disrupted. Damage reduced.` };
                    }
                    case 'reveal_map': {
                        const mapData = [...station.rooms.entries()].map(([id, r]) => ({
                            name: r.name,
                            visited: state.roomsVisited.has(id),
                            has_threat: r.threat !== null && getRoomThreat(id, station) !== null,
                            has_loot: r.loot !== null && !state.roomLootTaken.has(id),
                        }));
                        return { success: true, map: mapData, message: 'Station layout downloaded.' };
                    }
                    case 'secret_passage': {
                        const room = station.rooms.get(state.currentRoom);
                        if (!room?.secretConnection) return { error: 'No hidden passages detected.' };
                        const secretRoom = station.rooms.get(room.secretConnection);
                        if (secretRoom && !room.connections.includes(room.secretConnection)) {
                            room.connections.push(room.secretConnection);
                            secretRoom.connections.push(state.currentRoom);
                            return { success: true, message: `Hidden passage to ${secretRoom.name} revealed!` };
                        }
                        return { error: 'Passage already revealed.' };
                    }
                    default:
                        return { error: `Unknown hack target: ${args.target}` };
                }
            },
        }));
    }

    return tools;
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
