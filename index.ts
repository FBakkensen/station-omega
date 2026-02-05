import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { GameUI } from './tui';

// ─── Game Data ───────────────────────────────────────────────────────────────

interface Room {
    name: string;
    descriptionSeed: string;
    loot: string | null;
    threat: Enemy | null;
}

interface Enemy {
    name: string;
    hp: number;
    damage: [number, number]; // [min, max]
    drop: string | null;
}

function makeEnemy(name: string, hp: number, damage: [number, number], drop: string | null): Enemy {
    return { name, hp, damage, drop };
}

const ROOMS: Room[] = [
    {
        name: 'Airlock Bay',
        descriptionSeed: 'The entry point. Emergency lights flicker through floating debris. Your ship is docked behind you.',
        loot: 'medkit',
        threat: null,
    },
    {
        name: 'Crew Quarters',
        descriptionSeed: 'Overturned bunks, personal effects scattered. Claw marks on the walls. Something skitters in the vents.',
        loot: 'plasma_cell',
        threat: makeEnemy('lurker', 30, [10, 15], 'medkit'),
    },
    {
        name: 'Mess Hall',
        descriptionSeed: 'Half-eaten meals still on trays. The lights buzz. A faint smell of decay. Chairs overturned in a hurry.',
        loot: 'stim_pack',
        threat: null,
    },
    {
        name: 'Science Lab',
        descriptionSeed: 'Shattered containment pods. Biohazard warnings flash red. Viscous fluid drips from a cracked tank.',
        loot: 'keycard',
        threat: makeEnemy('mutant', 50, [15, 25], 'stim_pack'),
    },
    {
        name: 'Reactor Core',
        descriptionSeed: 'The reactor hums dangerously. Radiation warnings everywhere. The air tastes metallic. Time is running out.',
        loot: 'energy_shield',
        threat: makeEnemy('sentinel', 60, [20, 30], 'plasma_cell'),
    },
    {
        name: 'Command Bridge',
        descriptionSeed: 'The main console glows dimly. Screens show corrupted data feeds. The black box terminal is here.',
        loot: 'black_box',
        threat: makeEnemy('final_guardian', 80, [15, 25], null),
    },
];

// ─── Game State ──────────────────────────────────────────────────────────────

interface GameState {
    hp: number;
    maxHp: number;
    inventory: string[];
    currentRoom: number;
    roomsVisited: Set<number>;
    roomLootTaken: Set<number>;
    roomEnemyDefeated: Set<number>;
    hasBlackBox: boolean;
    gameOver: boolean;
    won: boolean;
    plasmaBoost: boolean;
    shieldActive: boolean;
}

const state: GameState = {
    hp: 100,
    maxHp: 100,
    inventory: [],
    currentRoom: 0,
    roomsVisited: new Set([0]),
    roomLootTaken: new Set(),
    roomEnemyDefeated: new Set(),
    hasBlackBox: false,
    gameOver: false,
    won: false,
    plasmaBoost: false,
    shieldActive: false,
};

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hpDescription(): string {
    const pct = state.hp / state.maxHp;
    if (pct >= 0.8) return 'You feel strong and healthy.';
    if (pct >= 0.5) return 'You have some cuts and bruises, but you can push on.';
    if (pct >= 0.25) return 'You\'re badly wounded. Blood drips from several gashes.';
    return 'You\'re barely standing. Vision blurring. Every breath hurts.';
}

// ─── Custom Tools ────────────────────────────────────────────────────────────

const lookAround = defineTool('look_around', {
    description: 'Look around the current room. Returns details about the environment, items, threats, and exits.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: () => {
        const room = ROOMS[state.currentRoom];
        const lootPresent = room.loot && !state.roomLootTaken.has(state.currentRoom);
        const threatPresent = room.threat && !state.roomEnemyDefeated.has(state.currentRoom);
        const exits: string[] = [];
        if (state.currentRoom > 0) exits.push('back');
        if (state.currentRoom < ROOMS.length - 1) exits.push('forward');

        return {
            room_name: room.name,
            room_number: `${String(state.currentRoom + 1)} of ${String(ROOMS.length)}`,
            description: room.descriptionSeed,
            item_visible: lootPresent ? room.loot : null,
            threat: threatPresent && room.threat ? { name: room.threat.name, demeanor: 'hostile' } : null,
            exits,
            player_condition: hpDescription(),
            inventory: state.inventory.length > 0 ? state.inventory : ['empty'],
        };
    },
});

const moveTo = defineTool('move_to', {
    description: 'Move to an adjacent room. Direction must be "forward" (deeper into the station) or "back" (toward the airlock).',
    parameters: {
        type: 'object',
        properties: {
            direction: { type: 'string', enum: ['forward', 'back'], description: 'Direction to move' },
        },
        required: ['direction'],
    },
    handler: (args: { direction: 'forward' | 'back' }) => {
        if (state.gameOver) return { error: 'The game is over.' };

        const { direction } = args;
        const newRoom = direction === 'forward' ? state.currentRoom + 1 : state.currentRoom - 1;

        if (newRoom < 0) return { error: 'You\'re at the airlock. There\'s nothing behind you but empty space.' };
        if (newRoom >= ROOMS.length) return { error: 'There\'s nowhere else to go. This is the deepest part of the station.' };

        // Keycard check for Command Bridge
        if (newRoom === 5 && !state.inventory.includes('keycard')) {
            return { error: 'The Command Bridge door requires a keycard. The access panel blinks red.' };
        }

        // Win condition: return to airlock with black box
        if (newRoom === 0 && state.hasBlackBox) {
            state.gameOver = true;
            state.won = true;
            return {
                success: true,
                room_name: ROOMS[0].name,
                event: 'VICTORY! You made it back to the airlock with the black box data. The airlock seals behind you as you board your ship.',
                game_over: true,
                won: true,
            };
        }

        state.currentRoom = newRoom;
        state.roomsVisited.add(newRoom);

        const room = ROOMS[newRoom];
        const threatPresent = room.threat && !state.roomEnemyDefeated.has(newRoom);

        return {
            success: true,
            room_name: room.name,
            room_number: `${String(newRoom + 1)} of ${String(ROOMS.length)}`,
            description: room.descriptionSeed,
            threat_present: threatPresent && room.threat ? room.threat.name : null,
            player_condition: hpDescription(),
        };
    },
});

const pickUpItem = defineTool('pick_up_item', {
    description: 'Pick up an item in the current room and add it to your inventory (max 5 items).',
    parameters: {
        type: 'object',
        properties: {
            item: { type: 'string', description: 'Name of the item to pick up' },
        },
        required: ['item'],
    },
    handler: (args: { item: string }) => {
        if (state.gameOver) return { error: 'The game is over.' };

        const room = ROOMS[state.currentRoom];
        const { item } = args;

        if (state.roomLootTaken.has(state.currentRoom)) {
            return { error: 'There\'s nothing left to pick up in this room.' };
        }
        if (room.loot !== item) {
            return { error: `There is no "${item}" here.` };
        }
        if (state.inventory.length >= 5) {
            return { error: 'Your inventory is full (5/5). Drop or use something first.' };
        }

        // Enemy must be defeated first
        if (room.threat && !state.roomEnemyDefeated.has(state.currentRoom)) {
            return { error: `The ${room.threat.name} is blocking the item. Deal with the threat first.` };
        }

        state.roomLootTaken.add(state.currentRoom);

        if (item === 'black_box') {
            state.hasBlackBox = true;
            return {
                success: true,
                item,
                message: 'You download the black box data to your portable drive. Now get back to the airlock!',
                objective: 'Return to the Airlock Bay (move back through all rooms) to escape.',
            };
        }

        state.inventory.push(item);
        return {
            success: true,
            item,
            inventory: state.inventory,
            slots_remaining: 5 - state.inventory.length,
        };
    },
});

const useItem = defineTool('use_item', {
    description: 'Use an item from your inventory. Items: medkit (heal 30 HP), stim_pack (heal 20 HP), plasma_cell (boost next attack +25 damage), energy_shield (block 20 damage in next combat).',
    parameters: {
        type: 'object',
        properties: {
            item: { type: 'string', description: 'Name of the item to use' },
        },
        required: ['item'],
    },
    handler: (args: { item: string }) => {
        if (state.gameOver) return { error: 'The game is over.' };

        const { item } = args;
        const idx = state.inventory.indexOf(item);
        if (idx === -1) {
            return { error: `You don't have "${item}" in your inventory.`, inventory: state.inventory };
        }

        state.inventory.splice(idx, 1);

        switch (item) {
            case 'medkit': {
                const healed = Math.min(30, state.maxHp - state.hp);
                state.hp += healed;
                return { success: true, item, effect: `Healed ${String(healed)} HP.`, player_condition: hpDescription() };
            }
            case 'stim_pack': {
                const healed = Math.min(20, state.maxHp - state.hp);
                state.hp += healed;
                return { success: true, item, effect: `Healed ${String(healed)} HP. Adrenaline surges through you.`, player_condition: hpDescription() };
            }
            case 'plasma_cell': {
                state.plasmaBoost = true;
                return { success: true, item, effect: 'Plasma cell loaded. Your next attack will deal +25 bonus damage.' };
            }
            case 'energy_shield': {
                state.shieldActive = true;
                return { success: true, item, effect: 'Energy shield activated. It will absorb 20 damage in the next fight.' };
            }
            case 'keycard':
                state.inventory.push(item); // don't consume keycard
                return { success: true, item, effect: 'The keycard is for the Command Bridge door. Keep it.' };
            default:
                return { error: `You can't use "${item}" right now.` };
        }
    },
});

const attack = defineTool('attack', {
    description: 'Attack the enemy in the current room. Describe your approach (e.g., "shoot from cover", "charge with pipe", "sneak behind it").',
    parameters: {
        type: 'object',
        properties: {
            approach: { type: 'string', description: 'How you attack — your strategy or action' },
        },
        required: ['approach'],
    },
    handler: (args: { approach: string }) => {
        if (state.gameOver) return { error: 'The game is over.' };

        const room = ROOMS[state.currentRoom];
        if (!room.threat || state.roomEnemyDefeated.has(state.currentRoom)) {
            return { error: 'There is no enemy to fight here.' };
        }

        const enemy = { ...room.threat }; // copy so we don't mutate template

        // Player attacks
        let playerDamage = randInt(15, 25);
        if (state.plasmaBoost) {
            playerDamage += 25;
            state.plasmaBoost = false;
        }
        enemy.hp -= playerDamage;

        // Enemy attacks back (if alive)
        let enemyDamage = 0;
        let shieldAbsorbed = 0;
        if (enemy.hp > 0) {
            enemyDamage = randInt(enemy.damage[0], enemy.damage[1]);
            if (state.shieldActive) {
                shieldAbsorbed = Math.min(20, enemyDamage);
                enemyDamage -= shieldAbsorbed;
                state.shieldActive = false;
            }
            state.hp -= enemyDamage;
        }

        const defeated = enemy.hp <= 0;
        if (defeated) {
            state.roomEnemyDefeated.add(state.currentRoom);
        }

        // Player death
        if (state.hp <= 0) {
            state.hp = 0;
            state.gameOver = true;
            return {
                approach: args.approach,
                player_damage_dealt: playerDamage,
                enemy_name: room.threat.name,
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
            enemy_name: room.threat.name,
            enemy_damage_dealt: enemyDamage,
            shield_absorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
            enemy_defeated: defeated,
            enemy_remaining_hp: defeated ? 0 : enemy.hp,
            player_condition: hpDescription(),
        };

        if (defeated && room.threat.drop) {
            result.loot_dropped = room.threat.drop;
            result.loot_hint = `The ${room.threat.name} dropped a ${room.threat.drop}. You can pick it up.`;
            // Place loot in room if room loot was already taken or was different
            if (state.roomLootTaken.has(state.currentRoom) || room.loot !== room.threat.drop) {
                // Add to room as bonus loot by temporarily setting room loot
                ROOMS[state.currentRoom] = { ...room, loot: room.threat.drop };
                state.roomLootTaken.delete(state.currentRoom);
            }
        }

        return result;
    },
});

// ─── System Message ──────────────────────────────────────────────────────────

const SYSTEM_MESSAGE = `You are the AI Game Master for "Station Omega", a sci-fi survival text adventure set on an abandoned space station.

SETTING: The player is a salvage operative who has boarded Station Omega, a derelict research station that went dark 3 months ago. Their mission: reach the Command Bridge, download the black box data, and escape back to the Airlock Bay.

NARRATION STYLE:
- Tense, atmospheric, cinematic. Think Alien meets Dead Space.
- Describe what the player sees, hears, and feels.
- Keep responses to 2-4 sentences for actions, slightly longer for new room descriptions.
- NEVER reveal exact HP numbers or game mechanics. Describe health narratively using the player_condition field from tools.
- Make combat visceral and dramatic based on the player's chosen approach.
- If the player dies (player_died: true), narrate a dramatic death scene and say "GAME OVER".
- If the player wins (won: true), narrate a triumphant escape scene and say "MISSION COMPLETE".

IMPORTANT RULES:
- Always use the available tools to resolve player actions. Do not make up game state.
- When the player enters a new room, use look_around to describe it.
- If the player says something conversational, stay in character as the station's environment/narrator.
- The player starts in the Airlock Bay (room 1 of 6).

Begin by welcoming the player and describing the Airlock Bay using the look_around tool.`;

// ─── Main Game Loop ──────────────────────────────────────────────────────────

function getStatus() {
    const room = ROOMS[state.currentRoom];
    return {
        hp: state.hp,
        maxHp: state.maxHp,
        roomName: room.name,
        roomNumber: state.currentRoom + 1,
        totalRooms: ROOMS.length,
        inventory: state.inventory.length > 0 ? state.inventory : [],
    };
}

async function main() {
    // Initialize Copilot SDK first (before TUI) so auth prompts are visible
    const client = new CopilotClient();
    const session = await client.createSession({
        model: 'gpt-4.1',
        streaming: true,
        tools: [lookAround, moveTo, pickUpItem, useItem, attack],
        systemMessage: { content: SYSTEM_MESSAGE },
    });

    // Now start the TUI
    const ui = new GameUI();
    await ui.init();
    ui.updateStatus(getStatus());

    // Stream AI responses into the TUI
    session.on('assistant.message_delta', (event) => {
        ui.appendNarrativeDelta(event.data.deltaContent);
    });
    session.on('session.idle', () => {
        ui.finalizeDelta();
        ui.updateStatus(getStatus());

        if (state.gameOver) {
            ui.showGameOver(state.won);
        }
    });

    // Kick off the game — Copilot will use look_around to describe room 0
    await session.sendAndWait({ prompt: 'I step through the airlock onto Station Omega. What do I see?' });

    // Wire up input from the TUI
    ui.onInput((input: string) => {
        if (state.gameOver) return;

        if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
            ui.destroy();
            void client.stop().then(() => { process.exit(0); });
            return;
        }

        void session.sendAndWait({ prompt: input });
    });
}

main().catch((err: unknown) => {
    // Write to stderr to bypass TUI
    process.stderr.write(`Fatal error: ${String(err)}\n`);
    process.exit(1);
});
