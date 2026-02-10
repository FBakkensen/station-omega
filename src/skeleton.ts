import type {
    RunConfig,
    StoryArc,
    Difficulty,
    RoomArchetype,
    RoomSkeleton,
    EnemySkeleton,
    ItemSkeleton,
    ObjectiveChain,
    ObjectiveStep,
    StationSkeleton,
    NPCBehaviorFlag,
} from './types.js';

// ─── Seeded PRNG (LCG) ─────────────────────────────────────────────────────

class SeededRNG {
    private state: number;

    constructor(seed: number) {
        this.state = seed % 2147483647;
        if (this.state <= 0) this.state += 2147483646;
    }

    next(): number {
        this.state = (this.state * 16807) % 2147483647;
        return (this.state - 1) / 2147483646;
    }

    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    pick<T>(arr: readonly T[]): T {
        return arr[Math.floor(this.next() * arr.length)];
    }

    shuffle<T>(arr: T[]): T[] {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ROOM_COUNTS: Record<Difficulty, [number, number]> = {
    normal: [8, 10],
    hard: [10, 12],
    nightmare: [12, 15],
};

const DIFFICULTY_MULT: Record<Difficulty, number> = {
    normal: 1.0,
    hard: 1.3,
    nightmare: 1.6,
};

const TIER_STATS: ReadonlyMap<1 | 2 | 3 | 4, { hp: number; damage: [number, number] }> = new Map([
    [1, { hp: 25, damage: [8, 12] }],
    [2, { hp: 45, damage: [14, 22] }],
    [3, { hp: 65, damage: [18, 28] }],
    [4, { hp: 90, damage: [14, 24] }],
]);

const BEHAVIOR_PRESETS: ReadonlyMap<1 | 2 | 3 | 4, { behaviors: NPCBehaviorFlag[]; hint: string; personality: string; fleeThreshold: number }> = new Map([
    [1, { behaviors: ['can_flee', 'can_beg'], hint: 'frightened creature', personality: 'Skittish, animal-like. Attacks from fear.', fleeThreshold: 0.3 }],
    [2, { behaviors: ['can_negotiate', 'is_intelligent', 'can_beg', 'can_trade'], hint: 'tragic half-human', personality: 'Mutated crew member. Flickers between rage and lucidity.', fleeThreshold: 0.25 }],
    [3, { behaviors: ['can_reinforce', 'can_ambush'], hint: 'relentless machine', personality: 'Mechanical. No negotiation. Follows protocol.', fleeThreshold: 0 }],
    [4, { behaviors: ['can_negotiate', 'is_intelligent', 'can_ally'], hint: 'station authority', personality: 'Former director. Corrupted but aware. Can be reasoned with.', fleeThreshold: 0 }],
]);

// ─── Archetype Selection ────────────────────────────────────────────────────

function archetypesForDepth(depth: number, maxDepth: number): RoomArchetype[] {
    if (depth === 0) return ['entry'];
    if (depth === maxDepth) return ['escape'];
    const pct = depth / maxDepth;
    if (pct <= 0.3) return ['quarters', 'utility', 'cargo'];
    if (pct <= 0.6) return ['science', 'medical', 'cargo'];
    if (pct <= 0.9) return ['reactor', 'restricted', 'command'];
    return ['command', 'restricted'];
}

// ─── Enemy Tier by Depth ────────────────────────────────────────────────────

function tierForDepth(depth: number, maxDepth: number, isObjective: boolean): 1 | 2 | 3 | 4 {
    if (isObjective) return 4;
    const pct = depth / maxDepth;
    if (pct <= 0.3) return 1;
    if (pct <= 0.55) return 2;
    if (pct <= 0.8) return 3;
    return 3; // tier 4 reserved for bosses
}

// ─── Objective Templates ────────────────────────────────────────────────────

interface ObjTemplate {
    title: string;
    steps: Array<{ description: string; archetype: RoomArchetype; needsItem: boolean }>;
}

const OBJECTIVE_TEMPLATES: ReadonlyMap<StoryArc, ObjTemplate> = new Map([
    ['parasite_outbreak', {
        title: 'Contain the Outbreak',
        steps: [
            { description: 'Collect bio-sample from infected area', archetype: 'science', needsItem: false },
            { description: 'Collect second bio-sample from medical bay', archetype: 'medical', needsItem: false },
            { description: 'Collect third bio-sample from cargo hold', archetype: 'cargo', needsItem: false },
            { description: 'Jettison samples from the airlock', archetype: 'escape', needsItem: true },
        ],
    }],
    ['ai_mutiny', {
        title: 'Override the AI',
        steps: [
            { description: 'Input override code at science terminal', archetype: 'science', needsItem: false },
            { description: 'Input override code at reactor terminal', archetype: 'reactor', needsItem: false },
            { description: 'Input override code at restricted terminal', archetype: 'restricted', needsItem: false },
            { description: 'Execute shutdown at command bridge', archetype: 'command', needsItem: true },
        ],
    }],
    ['dimensional_rift', {
        title: 'Close the Rift',
        steps: [
            { description: 'Collect the dimensional stabilizer', archetype: 'science', needsItem: false },
            { description: 'Activate the stabilizer at the reactor core', archetype: 'reactor', needsItem: true },
            { description: 'Escape before the rift collapses', archetype: 'escape', needsItem: false },
        ],
    }],
    ['corporate_betrayal', {
        title: 'Expose the Conspiracy',
        steps: [
            { description: 'Find classified documents in restricted area', archetype: 'restricted', needsItem: false },
            { description: 'Find whistleblower recording in quarters', archetype: 'quarters', needsItem: false },
            { description: 'Broadcast evidence from command bridge comms', archetype: 'command', needsItem: true },
            { description: 'Escape the station', archetype: 'escape', needsItem: false },
        ],
    }],
    ['time_anomaly', {
        title: 'Anchor the Timeline',
        steps: [
            { description: 'Collect temporal anchor from science lab', archetype: 'science', needsItem: false },
            { description: 'Collect temporal anchor from reactor core', archetype: 'reactor', needsItem: false },
            { description: 'Collect temporal anchor from medical bay', archetype: 'medical', needsItem: false },
            { description: 'Seal the anomaly source or enter it', archetype: 'restricted', needsItem: true },
        ],
    }],
    ['first_contact', {
        title: 'The Signal',
        steps: [
            { description: 'Find the alien translator device', archetype: 'science', needsItem: false },
            { description: 'Locate the signal source', archetype: 'restricted', needsItem: true },
            { description: 'Choose: communicate or destroy', archetype: 'command', needsItem: false },
        ],
    }],
]);

// ─── Main Generator ─────────────────────────────────────────────────────────

export function generateSkeleton(config: RunConfig): StationSkeleton {
    const rng = new SeededRNG(config.seed);
    const [minRooms, maxRooms] = ROOM_COUNTS[config.difficulty];
    const roomCount = rng.nextInt(minRooms, maxRooms);
    const mult = DIFFICULTY_MULT[config.difficulty];

    // 1. Generate main-path spine
    const spineLength = Math.max(5, Math.ceil(roomCount * 0.6));
    const branchCount = roomCount - spineLength;

    const rooms: RoomSkeleton[] = [];
    const maxDepth = spineLength - 1;

    // Create spine rooms
    for (let i = 0; i < spineLength; i++) {
        const archetypes = archetypesForDepth(i, maxDepth);
        rooms.push({
            id: `room_${String(i)}`,
            archetype: rng.pick(archetypes),
            depth: i,
            connections: [],
            lockedBy: null,
            lootSlot: null,
            enemySlot: null,
            isObjectiveRoom: false,
            secretConnection: null,
        });
    }

    // Connect spine linearly
    for (let i = 0; i < spineLength - 1; i++) {
        rooms[i].connections.push(rooms[i + 1].id);
        rooms[i + 1].connections.push(rooms[i].id);
    }

    // 2. Add branch rooms
    for (let b = 0; b < branchCount; b++) {
        const attachIdx = rng.nextInt(1, spineLength - 2); // attach to non-entry, non-escape spine node
        const parentRoom = rooms[attachIdx];
        const branchDepth = parentRoom.depth + (rng.next() > 0.5 ? 0 : 1);
        const archetypes = archetypesForDepth(branchDepth, maxDepth);
        const branchId = `room_${String(rooms.length)}`;

        rooms.push({
            id: branchId,
            archetype: rng.pick(archetypes),
            depth: branchDepth,
            connections: [parentRoom.id],
            lockedBy: null,
            lootSlot: null,
            enemySlot: null,
            isObjectiveRoom: false,
            secretConnection: null,
        });
        parentRoom.connections.push(branchId);

        // Occasionally create loops (30% chance)
        if (rng.next() < 0.3 && rooms.length > 3) {
            const loopTarget = rooms[rng.nextInt(1, rooms.length - 2)];
            if (loopTarget.id !== branchId && !loopTarget.connections.includes(branchId)) {
                rooms[rooms.length - 1].connections.push(loopTarget.id);
                loopTarget.connections.push(branchId);
            }
        }
    }

    const entryRoomId = rooms[0].id;
    const escapeRoomId = rooms[spineLength - 1].id;

    // 3. Place locked doors (1-2 on main path)
    const lockCount = rng.nextInt(1, 2);
    const keyItems: ItemSkeleton[] = [];
    const lockPositions: number[] = [];

    for (let l = 0; l < lockCount; l++) {
        // Lock a connection in the middle-to-late spine
        const lockIdx = rng.nextInt(Math.floor(spineLength * 0.4), spineLength - 2);
        if (lockPositions.includes(lockIdx)) continue;
        lockPositions.push(lockIdx);

        const keyId = `keycard_${String(l)}`;
        rooms[lockIdx + 1].lockedBy = keyId;

        // Place key in a room before the lock
        const keyDepthMax = lockIdx - 1;
        const keyRoomIdx = rng.nextInt(Math.max(1, keyDepthMax - 2), Math.max(1, keyDepthMax));
        const keyItem: ItemSkeleton = {
            id: keyId,
            category: 'key',
            effect: { type: 'key', value: 0, description: 'Unlocks a sealed door' },
            isKeyItem: true,
        };
        rooms[keyRoomIdx].lootSlot = keyItem;
        keyItems.push(keyItem);
    }

    // 4. Place enemies on difficulty curve
    const items: ItemSkeleton[] = [...keyItems];
    const enemies: EnemySkeleton[] = [];
    const enemyRooms = rooms.filter(r => r.id !== entryRoomId && r.id !== escapeRoomId);
    const enemyRoomsSorted = [...enemyRooms].sort((a, b) => a.depth - b.depth);

    // Place enemies on ~60% of non-entry/escape rooms
    const enemyCount = Math.ceil(enemyRoomsSorted.length * 0.6);
    const enemyTargets = rng.shuffle(enemyRoomsSorted).slice(0, enemyCount);

    for (const room of enemyTargets) {
        const isObj = room.isObjectiveRoom;
        const tier = tierForDepth(room.depth, maxDepth, isObj);
        const stats = TIER_STATS.get(tier);
        if (!stats) continue;

        const presets = BEHAVIOR_PRESETS.get(tier);
        if (!presets) continue;

        const enemyId = `enemy_${room.id}`;
        const hp = Math.round(stats.hp * mult);
        const dmgLow = Math.round(stats.damage[0] * mult);
        const dmgHigh = Math.round(stats.damage[1] * mult);

        // Enemy drops
        let dropId: string | null = null;
        if (tier <= 2 && rng.next() < 0.6) {
            dropId = `drop_${room.id}`;
            const dropEffect = rng.next() < 0.5
                ? { type: 'heal' as const, value: tier === 1 ? 20 : 30, description: tier === 1 ? 'Minor healing' : 'Moderate healing' }
                : { type: 'damage_boost' as const, value: 15, description: 'Boost next attack damage' };
            const dropItem: ItemSkeleton = {
                id: dropId,
                category: dropEffect.type === 'heal' ? 'medical' : 'weapon',
                effect: dropEffect,
                isKeyItem: false,
            };
            items.push(dropItem);
        }

        const enemy: EnemySkeleton = {
            id: enemyId,
            tier,
            hp,
            damage: [dmgLow, dmgHigh],
            dropItemId: dropId,
            behaviorHint: presets.hint,
            behaviors: [...presets.behaviors],
            personality: presets.personality,
            fleeThreshold: presets.fleeThreshold,
        };

        room.enemySlot = enemy;
        enemies.push(enemy);
    }

    // 5. Place items — ensure healing before first combat, weapon boost before tier 3+
    // Place a healing item in entry room if no loot there yet
    if (!rooms[0].lootSlot) {
        const healItem: ItemSkeleton = {
            id: 'emergency_medkit',
            category: 'medical',
            effect: { type: 'heal', value: 30, description: 'Emergency medkit' },
            isKeyItem: false,
        };
        rooms[0].lootSlot = healItem;
        items.push(healItem);
    }

    // Place a shield or damage boost before tier 3 enemies
    const tier3Rooms = rooms.filter(r => r.enemySlot && r.enemySlot.tier >= 3);
    if (tier3Rooms.length > 0) {
        const minTier3Depth = Math.min(...tier3Rooms.map(r => r.depth));
        const boostCandidates = rooms.filter(r => r.depth < minTier3Depth && !r.lootSlot && r.id !== entryRoomId);
        if (boostCandidates.length > 0) {
            const boostRoom = rng.pick(boostCandidates);
            const boostItem: ItemSkeleton = {
                id: 'energy_shield',
                category: 'weapon',
                effect: { type: 'shield', value: 20, description: 'Energy shield absorbs damage' },
                isKeyItem: false,
            };
            boostRoom.lootSlot = boostItem;
            items.push(boostItem);
        }
    }

    // Scatter additional utility items in empty rooms
    const emptyRooms = rooms.filter(r => !r.lootSlot && r.id !== entryRoomId && r.id !== escapeRoomId);
    const utilityItems: ItemSkeleton[] = [
        { id: 'heal_stim', category: 'medical', effect: { type: 'heal', value: 20, description: 'Stim pack — quick heal' }, isKeyItem: false },
        { id: 'plasma_cell', category: 'weapon', effect: { type: 'damage_boost', value: 25, description: 'Plasma cell — supercharge next attack' }, isKeyItem: false },
    ];

    for (const uItem of utilityItems) {
        if (emptyRooms.length === 0) break;
        const roomIdx = rng.nextInt(0, emptyRooms.length - 1);
        emptyRooms[roomIdx].lootSlot = uItem;
        items.push(uItem);
        emptyRooms.splice(roomIdx, 1);
    }

    // 6. Place objectives
    const template = OBJECTIVE_TEMPLATES.get(config.storyArc);
    if (!template) throw new Error(`Unknown story arc: ${config.storyArc}`);

    const objectiveSteps: ObjectiveStep[] = [];
    for (let s = 0; s < template.steps.length; s++) {
        const stepDef = template.steps[s];
        // Find a room matching the archetype
        let targetRoom = rooms.find(r => r.archetype === stepDef.archetype && !r.isObjectiveRoom);
        if (!targetRoom) {
            // Fall back to any non-objective room in the mid-to-late section
            targetRoom = rooms.find(r => r.depth >= Math.floor(maxDepth * 0.3) && !r.isObjectiveRoom && r.id !== entryRoomId);
        }
        if (!targetRoom) {
            targetRoom = rooms[rng.nextInt(1, rooms.length - 1)];
        }

        targetRoom.isObjectiveRoom = true;

        // If last step or needs item, create objective item
        let requiredItemId: string | null = null;
        if (stepDef.needsItem) {
            requiredItemId = `obj_item_${String(s)}`;
            const objItem: ItemSkeleton = {
                id: requiredItemId,
                category: 'objective',
                effect: { type: 'objective', value: 0, description: stepDef.description },
                isKeyItem: true,
            };
            // Place the objective item in an earlier objective room or a nearby room
            const prevObjRoom = objectiveSteps.length > 0
                ? rooms.find(r => r.id === objectiveSteps[objectiveSteps.length - 1].roomId)
                : null;
            const itemRoom = prevObjRoom && !prevObjRoom.lootSlot ? prevObjRoom
                : emptyRooms.length > 0 ? emptyRooms.splice(rng.nextInt(0, Math.max(0, emptyRooms.length - 1)), 1)[0]
                : null;
            if (itemRoom) {
                itemRoom.lootSlot = objItem;
                items.push(objItem);
            }
        }

        objectiveSteps.push({
            id: `obj_${String(s)}`,
            description: stepDef.description,
            roomId: targetRoom.id,
            requiredItemId,
            completed: false,
        });
    }

    // 7. Secret connections (for hacker/engineer)
    const secretCandidates = rooms.filter(r => r.connections.length <= 2 && r.depth > 0);
    if (secretCandidates.length >= 2 && rng.next() < 0.5) {
        const a = rng.pick(secretCandidates);
        const others = secretCandidates.filter(r => r.id !== a.id && !a.connections.includes(r.id));
        if (others.length > 0) {
            const b = rng.pick(others);
            a.secretConnection = b.id;
            b.secretConnection = a.id;
        }
    }

    // 8. Boss in escape-adjacent room (if no tier 4 placed yet)
    if (!enemies.some(e => e.tier === 4)) {
        const bossRoom = rooms.find(r => r.depth === maxDepth - 1 && !r.enemySlot);
        if (bossRoom) {
            const stats = TIER_STATS.get(4);
            const presets = BEHAVIOR_PRESETS.get(4);
            if (stats && presets) {
                const boss: EnemySkeleton = {
                    id: `enemy_boss`,
                    tier: 4,
                    hp: Math.round(stats.hp * mult),
                    damage: [Math.round(stats.damage[0] * mult), Math.round(stats.damage[1] * mult)],
                    dropItemId: null,
                    behaviorHint: presets.hint,
                    behaviors: [...presets.behaviors],
                    personality: presets.personality,
                    fleeThreshold: presets.fleeThreshold,
                };
                bossRoom.enemySlot = boss;
                enemies.push(boss);
            }
        }
    }

    // 9. Validate connectivity
    const visited = new Set<string>();
    const queue = [entryRoomId];
    visited.add(entryRoomId);
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const currentRoom = rooms.find(r => r.id === current);
        if (!currentRoom) continue;
        for (const conn of currentRoom.connections) {
            if (!visited.has(conn)) {
                visited.add(conn);
                queue.push(conn);
            }
        }
    }
    // If any rooms unreachable, connect them to nearest visited room
    for (const room of rooms) {
        if (!visited.has(room.id)) {
            const nearest = rooms.find(r => visited.has(r.id) && Math.abs(r.depth - room.depth) <= 1);
            if (nearest) {
                room.connections.push(nearest.id);
                nearest.connections.push(room.id);
                visited.add(room.id);
            }
        }
    }

    const objectives: ObjectiveChain = {
        storyArc: config.storyArc,
        title: template.title,
        steps: objectiveSteps,
        currentStepIndex: 0,
        completed: false,
    };

    return {
        config,
        rooms,
        items,
        enemies,
        objectives,
        entryRoomId,
        escapeRoomId,
    };
}
