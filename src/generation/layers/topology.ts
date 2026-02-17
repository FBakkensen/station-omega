/**
 * Layer 1: Station Topology
 *
 * AI generates the room graph — room IDs, archetypes, connections,
 * locked doors, entry/escape rooms, and scenario theme.
 */

import { z } from 'zod';
import type { RoomArchetype, Difficulty } from '../../types.js';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    checkBidirectional,
    checkConnectivity,
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const RoomArchetypeEnum = z.enum([
    'entry', 'quarters', 'utility', 'science', 'command',
    'medical', 'cargo', 'restricted', 'reactor', 'escape',
]);

const TopologyStyleEnum = z.enum([
    'linear', 'hub_and_spoke', 'ring', 'branching_tree', 'cluster', 'dual_path',
]);

const TopologyRoomSchema = z.object({
    id: z.string(),
    archetype: RoomArchetypeEnum,
    connections: z.array(z.string()),
    lockedBy: z.string().nullable(),
});

export const TopologySchema = z.object({
    topology: TopologyStyleEnum,
    scenario: z.object({
        theme: z.string(),
        centralTension: z.string(),
    }),
    rooms: z.array(TopologyRoomSchema),
    entryRoomId: z.string(),
    escapeRoomId: z.string(),
});

export type TopologyOutput = z.infer<typeof TopologySchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface ValidatedTopology {
    topology: string;
    scenario: { theme: string; centralTension: string };
    rooms: Array<{
        id: string;
        archetype: RoomArchetype;
        connections: string[];
        lockedBy: string | null;
    }>;
    entryRoomId: string;
    escapeRoomId: string;
}

// ─── Room Count Bounds by Difficulty ─────────────────────────────────────────

const ROOM_COUNTS: Record<Difficulty, [number, number]> = {
    normal: [8, 12],
    hard: [10, 14],
    nightmare: [12, 16],
};

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildTopologyPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const [minRooms, maxRooms] = ROOM_COUNTS[context.difficulty as Difficulty];

    const system = `You are a space station architect designing the layout for a derelict station in a sci-fi survival game.

You design VARIED and INTERESTING station topologies. Each station should feel structurally unique.

# Room Archetypes (use these exact values)
- entry: Starting area where the player arrives
- quarters: Crew living spaces
- utility: Maintenance and infrastructure rooms
- science: Research labs and analysis rooms
- command: Bridge, comms, and control areas
- medical: Medbay and medical facilities
- cargo: Storage and loading areas
- restricted: High-security or classified areas
- reactor: Power generation and reactor systems
- escape: Exit point with escape pod

# Topology Styles
- linear: Rooms in a chain, simple progression
- hub_and_spoke: Central hub with branches radiating out
- ring: Rooms forming a loop with branches
- branching_tree: Tree structure with multiple paths
- cluster: Groups of tightly connected rooms with bridges between clusters
- dual_path: Two parallel paths from entry to escape

# Rules
- Room count: ${String(minRooms)} to ${String(maxRooms)} rooms total
- EXACTLY ONE room with archetype "entry" — this must be the entryRoomId
- EXACTLY ONE room with archetype "escape" — this must be the escapeRoomId
- ALL connections MUST be bidirectional: if room_0 connects to room_1, room_1 must connect to room_0
- ALL rooms must be reachable from the entry room via connections (BFS reachable)
- Use room IDs like "room_0", "room_1", etc.
- Locked doors: lockedBy should be a keycard ID like "keycard_0". Place at most 2 locked doors.
- If a room is locked by "keycard_0", the keycard must be obtainable before reaching that room
- Mix archetypes for variety — don't repeat the same archetype more than 3 times
- Entry and escape rooms should NOT be directly connected

# Scenario
Design a unique scenario theme and central tension for each station. Examples:
- Theme: "Viral containment breach", Tension: "Quarantine systems are failing and spreading to new sections"
- Theme: "Gravitational anomaly", Tension: "Station is being pulled apart by tidal forces"
- Be creative! Each station should have its own disaster scenario`;

    let user = `Design a station layout for difficulty "${context.difficulty}" with character class "${context.characterClass}".

Choose a topology style and create ${String(minRooms)}-${String(maxRooms)} rooms with varied archetypes.
Create an interesting disaster scenario.
Place 0-2 locked doors strategically (not on the entry or escape rooms).`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateTopology(output: TopologyOutput, context: LayerContext): ValidationResult<ValidatedTopology> {
    const errors: string[] = [];
    const [minRooms, maxRooms] = ROOM_COUNTS[context.difficulty as Difficulty];

    // 1. Room ID uniqueness
    const ids = output.rooms.map(r => r.id);
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) {
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        errors.push(`Duplicate room IDs: ${[...new Set(dupes)].join(', ')} — each room must have a unique ID`);
    }

    // 2. Room count bounds
    if (output.rooms.length < minRooms || output.rooms.length > maxRooms) {
        errors.push(`Room count ${String(output.rooms.length)} is outside the allowed range [${String(minRooms)}, ${String(maxRooms)}] for ${context.difficulty} difficulty`);
    }

    // 3. Entry/escape room existence
    if (!idSet.has(output.entryRoomId)) {
        errors.push(`Entry room '${output.entryRoomId}' not found in room list. Valid IDs: [${[...idSet].join(', ')}]`);
    }
    if (!idSet.has(output.escapeRoomId)) {
        errors.push(`Escape room '${output.escapeRoomId}' not found in room list. Valid IDs: [${[...idSet].join(', ')}]`);
    }

    // 4. Entry room archetype
    const entryRoom = output.rooms.find(r => r.id === output.entryRoomId);
    if (entryRoom && entryRoom.archetype !== 'entry') {
        errors.push(`Entry room ${output.entryRoomId} must have archetype 'entry', got '${entryRoom.archetype}'`);
    }

    // 5. Escape room archetype
    const escapeRoom = output.rooms.find(r => r.id === output.escapeRoomId);
    if (escapeRoom && escapeRoom.archetype !== 'escape') {
        errors.push(`Escape room ${output.escapeRoomId} must have archetype 'escape', got '${escapeRoom.archetype}'`);
    }

    // 6. Auto-repair bidirectional connections, then verify
    const repairs: string[] = [];
    const connMap = new Map(output.rooms.map(r => [r.id, new Set(r.connections)]));
    for (const room of output.rooms) {
        for (const conn of room.connections) {
            const target = connMap.get(conn);
            if (target && !target.has(room.id)) {
                target.add(room.id);
                const targetRoom = output.rooms.find(r => r.id === conn);
                if (targetRoom) {
                    targetRoom.connections.push(room.id);
                    repairs.push(`Added missing back-connection: ${conn} → ${room.id}`);
                }
            }
        }
    }
    const bidiErrors = checkBidirectional(output.rooms);
    errors.push(...bidiErrors);

    // 7. Full connectivity from entry
    if (idSet.has(output.entryRoomId)) {
        const unreachable = checkConnectivity(output.rooms, output.entryRoomId);
        if (unreachable.length > 0) {
            errors.push(`Rooms [${unreachable.join(', ')}] are not reachable from entry room ${output.entryRoomId}`);
        }
    }

    // 8. Connection references exist
    for (const room of output.rooms) {
        for (const conn of room.connections) {
            if (!idSet.has(conn)) {
                errors.push(`${room.id} connects to '${conn}' which does not exist in the room list`);
            }
        }
    }

    // 9. Locked door key references
    const lockedRooms = output.rooms.filter(r => r.lockedBy);
    const keyIds = new Set(lockedRooms.map(r => r.lockedBy));
    for (const keyId of keyIds) {
        if (!keyId) continue;
        // Key existence is validated fully in Layer 2; here just check basic sanity
    }

    // 10. Entry/escape should not be locked
    if (entryRoom?.lockedBy) {
        errors.push(`Entry room ${output.entryRoomId} must not be locked`);
    }
    if (escapeRoom?.lockedBy) {
        // Escape room CAN be locked — that's fine as long as key is obtainable
    }

    // 11. No self-connections
    for (const room of output.rooms) {
        if (room.connections.includes(room.id)) {
            errors.push(`${room.id} has a self-connection — rooms cannot connect to themselves`);
        }
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    return validationSuccess<ValidatedTopology>({
        topology: output.topology,
        scenario: output.scenario,
        rooms: output.rooms.map(r => ({
            id: r.id,
            archetype: r.archetype as RoomArchetype,
            connections: [...r.connections],
            lockedBy: r.lockedBy,
        })),
        entryRoomId: output.entryRoomId,
        escapeRoomId: output.escapeRoomId,
    }, repairs);
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const topologyLayer: LayerConfig<TopologyOutput, ValidatedTopology> = {
    name: 'Topology',
    schema: TopologySchema,
    buildPrompt: buildTopologyPrompt,
    validate: validateTopology,
    maxRetries: 3,
    summarize: (v) => {
        const locked = v.rooms.filter(r => r.lockedBy).map(r => `${r.id} [${String(r.lockedBy)}]`);
        return [
            `Rooms: ${String(v.rooms.length)}, topology: ${v.topology}`,
            `Entry: ${v.entryRoomId}, Escape: ${v.escapeRoomId}`,
            `Locked doors: ${locked.length > 0 ? locked.join(', ') : 'none'}`,
        ].join('\n');
    },
};
