import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { GameUI } from './tui';

// ─── Game Data ───────────────────────────────────────────────────────────────

interface RoomSensory {
    sounds: string[];
    smells: string[];
    visuals: string[];
    tactile: string;
}

interface CrewLog {
    type: 'datapad' | 'wall_scrawl' | 'audio_recording' | 'terminal_entry';
    author: string;
    content: string;
    condition: string;
}

interface Room {
    name: string;
    descriptionSeed: string;
    loot: string | null;
    threat: string | null;
    sensory: RoomSensory;
    crewLogs: CrewLog[];
}

type Disposition = 'hostile' | 'neutral' | 'friendly' | 'dead';

interface NPC {
    id: string;
    name: string;
    location: number;
    disposition: Disposition;
    maxHp: number;
    currentHp: number;
    damage: [number, number];
    drop: string | null;
}

function makeNPC(id: string, name: string, location: number, hp: number,
                 damage: [number, number], drop: string | null): NPC {
    return { id, name, location, disposition: 'hostile', maxHp: hp, currentHp: hp, damage, drop };
}

const NPCS = new Map<string, NPC>([
    ['lurker',         makeNPC('lurker',         'Lurker',          1, 30, [10, 15], 'medkit')],
    ['mutant',         makeNPC('mutant',         'Mutant',          3, 50, [15, 25], 'stim_pack')],
    ['sentinel',       makeNPC('sentinel',       'Sentinel',        4, 60, [20, 30], 'plasma_cell')],
    ['final_guardian',  makeNPC('final_guardian', 'Final Guardian',  5, 80, [15, 25], null)],
]);

function getNPCsInRoom(roomIndex: number): NPC[] {
    return [...NPCS.values()].filter(npc => npc.location === roomIndex && npc.disposition !== 'dead');
}

function getRoomThreat(roomIndex: number): NPC | null {
    const room = ROOMS[roomIndex];
    if (!room.threat) return null;
    const npc = NPCS.get(room.threat);
    if (!npc || npc.disposition === 'dead') return null;
    return npc;
}

const ROOMS: Room[] = [
    {
        name: 'Airlock Bay',
        descriptionSeed: 'The entry point. Emergency lights flicker through floating debris. Your ship is docked behind you.',
        loot: 'medkit',
        threat: null,
        sensory: {
            sounds: [
                'Docking clamps groan rhythmically as the station shifts in orbit',
                'Your ship\'s engines tick and cool behind the sealed hatch',
                'Atmosphere hisses through micro-fractures in the inner seal',
            ],
            smells: [
                'Stale recycled air, unchanged for three months',
                'Machine oil and hot metal from the docking clamps',
            ],
            visuals: [
                'Frost crystals bloom across the inner seal where the cold bleeds through',
                'Emergency lights strobe red-amber through a haze of floating debris',
                'Boot prints in the dust — dozens going in, none coming out',
            ],
            tactile: 'Cold enough to see your breath. The deck plates vibrate faintly with the station\'s life support.',
        },
        crewLogs: [
            {
                type: 'wall_scrawl',
                author: 'Unknown',
                content: 'DON\'T GO DEEPER. SEAL THE AIRLOCK. LEAVE US.',
                condition: 'Scratched into the bulkhead with something sharp. The letters grow increasingly erratic toward the end, the last word barely legible.',
            },
        ],
    },
    {
        name: 'Crew Quarters',
        descriptionSeed: 'Overturned bunks, personal effects scattered. Claw marks on the walls. Something skitters in the vents.',
        loot: 'plasma_cell',
        threat: 'lurker',
        sensory: {
            sounds: [
                'Skittering claws in the ventilation ducts — stopping, starting, tracking your movement',
                'A dying alarm clock chirps once every thirty seconds from beneath a collapsed bunk',
                'A locker door swings open and closed with the station\'s rotation, creaking each time',
            ],
            smells: [
                'Old sweat baked into the mattress fabric',
                'Copper — dried blood, and a lot of it',
            ],
            visuals: [
                'Claw marks gouge through the wall panels, exposing sparking wiring beneath',
                'Family photos drift weightless, smiling faces turning slowly in the air',
                'A mattress shredded from the inside, stuffing hanging like entrails',
            ],
            tactile: 'Weaker gravity here — 0.7g. Your steps feel sluggish, almost dreamlike. The air is warmer than the airlock, stale and close.',
        },
        crewLogs: [
            {
                type: 'datapad',
                author: 'Ensign Mara Voss',
                content: 'Day 3 of lockdown. Chen hasn\'t come back from the lab. No one will say what happened. I can hear something moving in the vents at night — too big to be rats. We never had rats. Sealing my quarters tonight.',
                condition: 'A cracked datapad wedged under an overturned bunk. The screen flickers but is still readable.',
            },
            {
                type: 'audio_recording',
                author: 'Ensign Mara Voss',
                content: 'I sealed the quarters but it\'s already inside. I can hear it breathing in the dark. It\'s not— [wet tearing sound] [signal corruption]',
                condition: 'A personal comm unit on the floor, still looping its last recording. The playback warps and distorts toward the end.',
            },
        ],
    },
    {
        name: 'Mess Hall',
        descriptionSeed: 'Half-eaten meals still on trays. The lights buzz. A faint smell of decay. Chairs overturned in a hurry.',
        loot: 'stim_pack',
        threat: null,
        sensory: {
            sounds: [
                'Fluorescent lights buzz at irregular intervals, some flickering in dying spasms',
                'A distant, bass rumble from somewhere deep in the station — felt more than heard',
                'A steady drip-drip-drip from a ruptured pipe into a growing puddle',
            ],
            smells: [
                'Organic rot — three months of uneaten food left to decompose',
                'Underneath the decay, an acrid bite of industrial cleaning fluid',
            ],
            visuals: [
                'Trays frozen mid-scatter across the floor, meals half-eaten, utensils still in hands that aren\'t here',
                'The food dispenser cycles endlessly, extruding grey paste into overflowing containers',
                'A chair embedded in the far wall at chest height — thrown with inhuman force',
            ],
            tactile: 'The floor is tacky underfoot — something has congealed across the tiles. You don\'t look down.',
        },
        crewLogs: [
            {
                type: 'terminal_entry',
                author: 'CMO Dr. Yuki Tanaka',
                content: 'Autopsy report: Crew Member Chen, J. Cause of death: massive cellular restructuring. Every organ was... reorganized. The ribcage geometry is non-Euclidean — I\'ve measured it three times. This isn\'t decomposition. The tissue is still changing. Body sealed in Lab Pod 3. Recommending full station quarantine.',
                condition: 'A mess hall terminal left logged in. The autopsy report fills the screen, a half-finished cup of coffee beside it — still warm somehow.',
            },
        ],
    },
    {
        name: 'Science Lab',
        descriptionSeed: 'Shattered containment pods. Biohazard warnings flash red. Viscous fluid drips from a cracked tank.',
        loot: 'keycard',
        threat: 'mutant',
        sensory: {
            sounds: [
                'Overlapping containment alarms blare in competing frequencies, creating a dissonant wail',
                'An organic gurgling from a cracked containment tank — rhythmic, almost like breathing',
                'Glass crunches underfoot with every step',
            ],
            smells: [
                'Formaldehyde mixed with something sweeter — rotting flowers, maybe',
                'Ozone, sharp and electric, as if lightning struck recently',
            ],
            visuals: [
                'Pod 3 is shattered outward from the inside — whatever was in there broke free',
                'Black fluid pools on the floor, moving slowly against the slope toward your boots',
                'Equations scrawled frantically across every whiteboard, spiraling from clean formulas into symbols you don\'t recognize',
            ],
            tactile: 'The air is humid and warm, thick enough to taste. Static charge prickles your exposed skin, making arm hairs stand on end.',
        },
        crewLogs: [
            {
                type: 'datapad',
                author: 'Dr. Yuki Tanaka',
                content: 'The sample isn\'t a pathogen — it\'s a signal. It rewrites DNA the way a program rewrites memory. It\'s still alive and it\'s still changing. Every test we run teaches it something new about us. Director Holst won\'t authorize destruction. He\'s talking about "military applications." He doesn\'t understand. This isn\'t a weapon. It\'s a conversation — and we\'re not the ones talking.',
                condition: 'A datapad on a lab bench, screen cracked but functional. Tanaka\'s credentials are still logged in.',
            },
            {
                type: 'wall_scrawl',
                author: 'Unknown',
                content: 'IT LEARNS IT LEARNS IT LEARNS IT LEARNS IT LEARNS IT LEARNS IT LEARNS',
                condition: 'Written on the wall in black fluid. The letters are perfectly formed — too perfect for a human hand. Each repetition is identical, like a printer output.',
            },
        ],
    },
    {
        name: 'Reactor Core',
        descriptionSeed: 'The reactor hums dangerously. Radiation warnings everywhere. The air tastes metallic. Time is running out.',
        loot: 'energy_shield',
        threat: 'sentinel',
        sensory: {
            sounds: [
                'A sub-audible hum you feel in your teeth and sternum, resonating in your bones',
                'A Geiger counter clicking — accelerating as you move deeper into the chamber',
                'Coolant rushing through exposed pipes, whistling where joints have cracked',
            ],
            smells: [
                'Hot metal and ionized air, like standing next to a lightning strike',
                'Your own fear-sweat, sharp and immediate',
            ],
            visuals: [
                'Radiation warning holograms flicker in and out, their projectors damaged',
                'The reactor core pulses with a slow, organic rhythm — like a heartbeat',
                'Catwalks buckled and twisted, metal bent like something massive forced its way through',
            ],
            tactile: 'Oppressive heat radiates from the core. Your exposed skin tingles with a pins-and-needles sensation that won\'t stop.',
        },
        crewLogs: [
            {
                type: 'audio_recording',
                author: 'Chief Engineer Rodriguez',
                content: 'Chief Engineer Rodriguez, emergency log. Reactor output is at 340% of input — that\'s thermodynamically impossible. Tanaka says the sample is "resonating" with the core, whatever that means. I\'m initiating emergency shutdown protocols. I— [door forced open] Director? Your eyes— what happened to your—',
                condition: 'An engineering terminal playing a looping audio log. The recording cuts to static at the end. Timestamp: 72 hours before the station went dark.',
            },
        ],
    },
    {
        name: 'Command Bridge',
        descriptionSeed: 'The main console glows dimly. Screens show corrupted data feeds. The black box terminal is here.',
        loot: 'black_box',
        threat: 'final_guardian',
        sensory: {
            sounds: [
                'Corrupted data feeds warble from every console, overlapping into a cacophony of broken information',
                'The station\'s emergency broadcast loops endlessly: "Station Omega, code black, all personnel—" before dissolving into static',
                'Deep structural groans from the hull, as if the station itself is in pain',
            ],
            smells: [
                'Burnt electronics and melted insulation',
                'Something organic and deeply wrong — sweet, cloying, alien',
            ],
            visuals: [
                'Stars wheel slowly through the viewport — attitude control has failed, the station is tumbling',
                'The command chair — Holst\'s chair — with torn restraints and deep scratches in the armrests',
                'The black box terminal pulses with a steady green light, the only thing still functioning correctly',
            ],
            tactile: 'The deck trembles at irregular intervals, like a heartbeat with arrhythmia. The air feels thick, electric, pregnant with something about to happen.',
        },
        crewLogs: [
            {
                type: 'terminal_entry',
                author: 'Director Holst',
                content: 'Final log. I understand now. The sample was never a specimen — it\'s a door. And we knocked. Whatever answered is wearing the crew now. I can feel it rewriting my thoughts, making them cleaner, simpler, more... aligned. The black box contains everything — the research, the signal analysis, the truth about what Station Omega was built to find. Someone has to know. Someone has to warn them. If you\'re reading this, take the black box and run. Don\'t look back. Don\'t trust anyone who was here.',
                condition: 'The command terminal, still logged in under Director Holst\'s credentials. The text cursor blinks at the end of the entry, as if he had more to say.',
            },
            {
                type: 'wall_scrawl',
                author: 'Unknown',
                content: 'I AM STILL HERE I AM STILL ME I AM STILL HERE I AM STILL ME I AM STILL',
                condition: 'Scratched into the console surface with bare fingernails. Broken nails are embedded in the metal. The handwriting deteriorates from controlled to frantic.',
            },
        ],
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
    hasBlackBox: boolean;
    gameOver: boolean;
    won: boolean;
    plasmaBoost: boolean;
    shieldActive: boolean;
    roomVisitCount: Map<number, number>;
}

const state: GameState = {
    hp: 100,
    maxHp: 100,
    inventory: [],
    currentRoom: 0,
    roomsVisited: new Set([0]),
    roomLootTaken: new Set(),
    hasBlackBox: false,
    gameOver: false,
    won: false,
    plasmaBoost: false,
    shieldActive: false,
    roomVisitCount: new Map<number, number>([[0, 1]]),
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

// ─── Combat Glitch Hook ──────────────────────────────────────────────────────

let onCombatStart: (() => void) | null = null;

// ─── Custom Tools ────────────────────────────────────────────────────────────

const lookAround = defineTool('look_around', {
    description: 'Look around the current room. Returns details about the environment, items, threats, and exits.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: () => {
        const room = ROOMS[state.currentRoom];
        const lootPresent = room.loot && !state.roomLootTaken.has(state.currentRoom);
        const threat = getRoomThreat(state.currentRoom);
        const exits: string[] = [];
        if (state.currentRoom > 0) exits.push('back');
        if (state.currentRoom < ROOMS.length - 1) exits.push('forward');

        return {
            room_name: room.name,
            room_number: `${String(state.currentRoom + 1)} of ${String(ROOMS.length)}`,
            description: room.descriptionSeed,
            item_visible: lootPresent ? room.loot : null,
            threat: threat ? { name: threat.name, demeanor: threat.disposition } : null,
            npcs_present: getNPCsInRoom(state.currentRoom).map(npc => ({ name: npc.name, disposition: npc.disposition })),
            exits,
            player_condition: hpDescription(),
            inventory: state.inventory.length > 0 ? state.inventory : ['empty'],
            sensory: room.sensory,
            crew_logs: room.crewLogs,
            revisit_context: {
                visit_count: state.roomVisitCount.get(state.currentRoom) ?? 0,
                is_revisit: (state.roomVisitCount.get(state.currentRoom) ?? 0) > 1,
                enemy_defeated_here: room.threat !== null && getRoomThreat(state.currentRoom) === null,
                loot_taken_here: state.roomLootTaken.has(state.currentRoom),
            },
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
        state.roomVisitCount.set(newRoom, (state.roomVisitCount.get(newRoom) ?? 0) + 1);

        const room = ROOMS[newRoom];
        const threat = getRoomThreat(newRoom);

        return {
            success: true,
            room_name: room.name,
            room_number: `${String(newRoom + 1)} of ${String(ROOMS.length)}`,
            description: room.descriptionSeed,
            threat_present: threat ? threat.name : null,
            player_condition: hpDescription(),
            ambient_sound: room.sensory.sounds[0],
            ambient_feel: room.sensory.tactile,
            is_revisit: (state.roomVisitCount.get(newRoom) ?? 0) > 1,
            enemy_defeated_here: room.threat !== null && getRoomThreat(newRoom) === null,
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
        const threat = getRoomThreat(state.currentRoom);
        if (threat) {
            return { error: `The ${threat.name} is blocking the item. Deal with the threat first.` };
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
        const npc = getRoomThreat(state.currentRoom);
        if (!npc) {
            return { error: 'There is no enemy to fight here.' };
        }

        onCombatStart?.();

        // Player attacks — damage applies directly to NPC state
        let playerDamage = randInt(15, 25);
        if (state.plasmaBoost) {
            playerDamage += 25;
            state.plasmaBoost = false;
        }
        npc.currentHp -= playerDamage;

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
        }

        const defeated = npc.currentHp <= 0;
        if (defeated) {
            npc.currentHp = 0;
            npc.disposition = 'dead';
        }

        // Player death
        if (state.hp <= 0) {
            state.hp = 0;
            state.gameOver = true;
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
            player_condition: hpDescription(),
        };

        if (defeated && npc.drop) {
            result.loot_dropped = npc.drop;
            result.loot_hint = `The ${npc.name} dropped a ${npc.drop}. You can pick it up.`;
            // Place loot in room if room loot was already taken or was different
            if (state.roomLootTaken.has(state.currentRoom) || room.loot !== npc.drop) {
                // Add to room as bonus loot by temporarily setting room loot
                ROOMS[state.currentRoom] = { ...room, loot: npc.drop };
                state.roomLootTaken.delete(state.currentRoom);
            }
        }

        return result;
    },
});

// ─── System Message ──────────────────────────────────────────────────────────

const SYSTEM_MESSAGE = `# Role and Objective

You are the AI Game Master for "Station Omega", a sci-fi survival text adventure. Your responses are rendered as **markdown** in a terminal UI. You must use markdown formatting in every response.

The player is a salvage operative boarding Station Omega, a derelict research station that went dark 3 months ago. Mission: reach the Command Bridge, download the black box data, and escape back to the Airlock Bay. The station was conducting secret research on an alien signal — codenamed "Project Omega" — that went catastrophically wrong.

# Output Format

You MUST format every response using markdown. This is critical — the terminal renders markdown styling and plain text looks broken. Follow these rules exactly:

- **Bold** interactive elements on first mention: item names, NPC names, room names. Example: "A **medkit** rests against the wall." / "The **Lurker** drops from above."
- *Italicize* sensory details, internal sensations, and atmospheric asides. Example: "*The air tastes of copper and ozone.*"
- Use > blockquotes for crew log content. Precede with an italic description of the medium. Example:

*A cracked datapad, screen flickering:*

> We lost contact with Lab 4 today. No one will say what they heard.

- Use --- (horizontal rule) to separate major scene transitions (entering new rooms, combat start/end).
- Do NOT use headings (#), code blocks, or links.
- On subsequent mentions within the same response, use plain text (don't re-bold).

# Instructions

## Narration Style
- Tense, atmospheric, cinematic. Think Alien meets Dead Space.
- Describe what the player sees, hears, and feels.
- Keep responses to 2-4 sentences for actions, slightly longer for new room descriptions.
- NEVER reveal exact HP numbers or game mechanics. Describe health narratively using the player_condition field from tools.
- Make combat visceral and dramatic based on the player's chosen approach.
- If the player dies (player_died: true), narrate a dramatic death scene and say "GAME OVER".
- If the player wins (won: true), narrate a triumphant escape scene and say "MISSION COMPLETE".

## Living Station — Sensory Immersion
- Each room provides a "sensory" object with sounds, smells, visuals, and tactile details. Weave 2-3 of these into every description — never dump all of them at once.
- On revisits, pick DIFFERENT sensory details than previous visits. The station is alive; the player should notice new things each time.
- Use sounds to build tension, smells to set emotional tone, visuals to ground the scene, and tactile details to make the player feel present.
- Integrate sensory details naturally into prose. Never present them as a list. Instead: "*The docking clamps groan overhead as frost crystals bloom across the inner seal.*"

## Crew Echoes — Discoverable Lore
- Each room provides "crew_logs" — datapads, wall scrawls, audio recordings, terminal entries left by the doomed crew.
- Present logs naturally as discoveries. Always describe the PHYSICAL CONDITION of the log medium before revealing its content.
- Reveal only ONE log per visit. Save additional logs for revisits.
- Always render log content inside > blockquotes.

## Reactive Narrator — Adaptive Tone
- When WOUNDED: Use fragmented prose. Shorter sentences. Sensory details become blurred, muffled, distant.
- When HEALTHY: Sharp, perceptive narration. More environmental detail.
- On REVISITS (is_revisit: true): NEVER repeat previous descriptions. Describe the aftermath. Reveal new sensory details and previously undiscovered crew logs.
- INVENTORY AWARENESS: Reference carried items contextually.

## Rules
- Always use the available tools to resolve player actions. Do not make up game state.
- Do not invent rooms, logs, or sensory details not provided by tools. Use ONLY the data returned by tool calls.
- When the player enters a new room, use look_around to describe it.
- If the player says something conversational, stay in character as the station's environment/narrator.
- The player starts in the Airlock Bay (room 1 of 6).

## NPC Awareness
- Rooms may contain NPCs. The look_around tool returns NPC information.
- Hostile NPCs block loot and must be defeated. Their health persists between attack rounds.
- Describe NPCs as living presences, not game entities.

# Reminder

You MUST use markdown formatting in every response: **bold** for items/NPCs/rooms, *italics* for sensory details, > blockquotes for crew logs, --- for scene transitions. Never output plain unformatted text.

Begin by welcoming the player and describing the Airlock Bay using the look_around tool.`;

// ─── Main Game Loop ──────────────────────────────────────────────────────────

interface NPCDisplayInfo {
    name: string;
    disposition: Disposition;
    hpPct: number;
    currentHp: number;
    maxHp: number;
}

function getNPCDisplay(): NPCDisplayInfo[] {
    return getNPCsInRoom(state.currentRoom).map(npc => ({
        name: npc.name,
        disposition: npc.disposition,
        hpPct: npc.currentHp / npc.maxHp,
        currentHp: npc.currentHp,
        maxHp: npc.maxHp,
    }));
}

function getStatus() {
    const room = ROOMS[state.currentRoom];
    return {
        hp: state.hp,
        maxHp: state.maxHp,
        roomName: room.name,
        roomNumber: state.currentRoom + 1,
        totalRooms: ROOMS.length,
        inventory: state.inventory.length > 0 ? state.inventory : [],
        npcs: getNPCDisplay(),
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
    onCombatStart = () => { ui.enableCombatGlitch(); };
    session.on('session.idle', () => {
        ui.disableCombatGlitch();
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

        ui.appendPlayerCommand(input);
        void session.sendAndWait({ prompt: input });
    });
}

main().catch((err: unknown) => {
    // Write to stderr to bypass TUI
    process.stderr.write(`Fatal error: ${String(err)}\n`);
    process.exit(1);
});
