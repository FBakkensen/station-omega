import type {
    RunConfig,
    Difficulty,
    RoomArchetype,
    RoomSkeleton,
    ItemSkeleton,
    ObjectiveChain,
    ObjectiveStep,
    StationSkeleton,
    SystemFailureSkeleton,
    ActionDifficulty,
} from './types.js';
import { SYSTEM_FAILURE_POOLS, ENGINEERING_ITEMS, OBJECTIVE_TEMPLATES } from './data.js';

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

// ─── System Failure Severity by Depth ───────────────────────────────────────

function severityForDepth(depth: number, maxDepth: number): 1 | 2 | 3 {
    const pct = depth / maxDepth;
    if (pct <= 0.3) return 1;
    if (pct <= 0.6) return 2;
    return 3;
}

function difficultyForSeverity(severity: 1 | 2 | 3): ActionDifficulty {
    if (severity === 1) return 'easy';
    if (severity === 2) return 'moderate';
    return 'hard';
}

// ─── Main Generator ─────────────────────────────────────────────────────────

export function generateSkeleton(config: RunConfig): StationSkeleton {
    const rng = new SeededRNG(config.seed);
    const [minRooms, maxRooms] = ROOM_COUNTS[config.difficulty];
    const roomCount = rng.nextInt(minRooms, maxRooms);
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
            isObjectiveRoom: false,
            secretConnection: null,
            systemFailures: [],
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
            isObjectiveRoom: false,
            secretConnection: null,
            systemFailures: [],
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

    // 4. Place system failures on ~80% of non-entry/escape rooms
    const items: ItemSkeleton[] = [...keyItems];
    const failureRooms = rooms.filter(r => r.id !== entryRoomId && r.id !== escapeRoomId);
    const failureCount = Math.ceil(failureRooms.length * 0.8);
    const failureTargets = rng.shuffle([...failureRooms]).slice(0, failureCount);

    // Track all required materials for placement
    const materialsNeeded = new Map<string, number>();

    for (const room of failureTargets) {
        const pool = SYSTEM_FAILURE_POOLS.get(room.archetype);
        if (!pool || pool.length === 0) continue;

        const severity = severityForDepth(room.depth, maxDepth);
        const difficulty = difficultyForSeverity(severity);

        // Pick 1-2 failures for this room
        const numFailures = severity >= 2 && rng.next() < 0.3 ? 2 : 1;
        const shuffledPool = rng.shuffle([...pool]);
        const selected = shuffledPool.slice(0, numFailures);

        for (const template of selected) {
            const failureMode = rng.pick(template.failureModes);
            const turnsUntilCascade = severity === 1 ? 0 : (severity === 2 ? rng.nextInt(6, 10) : rng.nextInt(3, 6));
            const hazardPerTurn = severity === 1 ? 0 : (severity === 2 ? 2 : 5);

            // Pick a cascade target (adjacent room, if cascade timer is set)
            let cascadeTarget: string | null = null;
            if (turnsUntilCascade > 0 && room.connections.length > 0) {
                const candidates = room.connections.filter(id => id !== entryRoomId);
                if (candidates.length > 0) {
                    cascadeTarget = rng.pick(candidates);
                }
            }

            const failure: SystemFailureSkeleton = {
                systemId: template.systemId,
                failureMode,
                severity,
                requiredMaterials: [...template.requiredMaterials],
                requiredSkill: template.requiredSkill,
                difficulty,
                turnsUntilCascade,
                cascadeTarget,
                hazardPerTurn,
                diagnosisHint: template.diagnosisHint,
                mitigationPaths: [...template.mitigationPaths],
            };

            room.systemFailures.push(failure);

            // Track materials needed
            for (const mat of template.requiredMaterials) {
                materialsNeeded.set(mat, (materialsNeeded.get(mat) ?? 0) + 1);
            }
        }
    }

    // 5. Place engineering materials — ensure all required materials are reachable
    const emptyRooms = rooms.filter(r => !r.lootSlot && r.id !== entryRoomId && r.id !== escapeRoomId);

    // Place a starting supply in the entry room
    if (!rooms[0].lootSlot) {
        const firstAidItem: ItemSkeleton = {
            id: 'emergency_medkit',
            category: 'medical',
            effect: { type: 'heal', value: 30, description: 'Emergency medkit' },
            isKeyItem: false,
        };
        rooms[0].lootSlot = firstAidItem;
        items.push(firstAidItem);
    }

    // Place required materials in reachable rooms before the failures that need them
    for (const [matId, count] of materialsNeeded) {
        for (let i = 0; i < count; i++) {
            if (emptyRooms.length === 0) break;
            const roomIdx = rng.nextInt(0, emptyRooms.length - 1);
            const targetRoom = emptyRooms[roomIdx];

            const engItem = ENGINEERING_ITEMS.get(matId);
            const itemId = `${matId}_${String(items.length)}`;
            const matItem: ItemSkeleton = {
                id: itemId,
                category: engItem?.category ?? 'material',
                effect: engItem?.effect ?? { type: 'material', value: 1, description: matId.replace(/_/g, ' ') },
                isKeyItem: false,
            };
            targetRoom.lootSlot = matItem;
            items.push(matItem);
            emptyRooms.splice(roomIdx, 1);
        }
    }

    // Scatter additional engineering materials and medical supplies in remaining empty rooms
    const scatterItems: string[] = ['sealant_patch', 'insulated_wire', 'stim_injector', 'solvent', 'structural_epoxy'];
    for (const itemKey of scatterItems) {
        if (emptyRooms.length === 0) break;
        const roomIdx = rng.nextInt(0, emptyRooms.length - 1);
        const engItem = ENGINEERING_ITEMS.get(itemKey);
        if (!engItem) continue;

        const itemId = `${itemKey}_${String(items.length)}`;
        const scatterItem: ItemSkeleton = {
            id: itemId,
            category: engItem.category,
            effect: { ...engItem.effect },
            isKeyItem: false,
        };
        emptyRooms[roomIdx].lootSlot = scatterItem;
        items.push(scatterItem);
        emptyRooms.splice(roomIdx, 1);
    }

    // 7. Place objectives
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
            requiredSystemRepair: stepDef.requiredSystemRepair,
            completed: false,
        });
    }

    // 8. Secret connections (for engineer class)
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
        objectives,
        entryRoomId,
        escapeRoomId,
    };
}
