/**
 * Shared validation utilities for AI generation layers.
 *
 * All functions return error strings (fed back to the AI on retry)
 * or null when valid. This dual-purpose design means validators
 * both check correctness AND produce actionable guidance.
 */

interface RoomLike {
    id: string;
    connections: string[];
    lockedBy?: string | null;
}

/** Check that a room ID exists in the given room list. */
export function checkRoomExists(roomId: string, rooms: RoomLike[]): string | null {
    const ids = new Set(rooms.map(r => r.id));
    if (!ids.has(roomId)) {
        return `Room '${roomId}' does not exist. Valid room IDs: [${rooms.map(r => r.id).join(', ')}]`;
    }
    return null;
}

/** Check that all room connections are bidirectional. Returns all asymmetric errors. */
export function checkBidirectional(rooms: RoomLike[]): string[] {
    const errors: string[] = [];
    const idSet = new Set(rooms.map(r => r.id));
    const connMap = new Map<string, Set<string>>();
    for (const room of rooms) {
        connMap.set(room.id, new Set(room.connections));
    }

    for (const room of rooms) {
        for (const conn of room.connections) {
            if (!idSet.has(conn)) {
                errors.push(`${room.id} connects to ${conn} but ${conn} does not exist in the room list`);
                continue;
            }
            const target = connMap.get(conn);
            if (target && !target.has(room.id)) {
                errors.push(`${room.id} connects to ${conn} but ${conn} does not connect back to ${room.id}`);
            }
        }
    }
    return errors;
}

/** BFS from entryId. Returns list of unreachable room IDs. */
export function checkConnectivity(rooms: RoomLike[], entryId: string): string[] {
    const idSet = new Set(rooms.map(r => r.id));
    if (!idSet.has(entryId)) return [...idSet];

    const connMap = new Map<string, string[]>();
    for (const room of rooms) {
        connMap.set(room.id, room.connections);
    }

    const visited = new Set<string>([entryId]);
    const queue: string[] = [entryId];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const connections = connMap.get(current) ?? [];
        for (const neighbor of connections) {
            if (idSet.has(neighbor) && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return rooms.filter(r => !visited.has(r.id)).map(r => r.id);
}

/**
 * BFS reachability from a given room, optionally excluding locked doors.
 * Returns set of reachable room IDs (includes the start room).
 */
export function computeReachableRooms(
    fromRoom: string,
    rooms: RoomLike[],
    excludeLockedDoors: boolean = false,
): Set<string> {
    const idSet = new Set(rooms.map(r => r.id));
    if (!idSet.has(fromRoom)) return new Set();

    const connMap = new Map<string, string[]>();
    const lockMap = new Map<string, string | null>();
    for (const room of rooms) {
        connMap.set(room.id, room.connections);
        lockMap.set(room.id, room.lockedBy ?? null);
    }

    const visited = new Set<string>([fromRoom]);
    const queue: string[] = [fromRoom];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const connections = connMap.get(current) ?? [];
        for (const neighbor of connections) {
            if (visited.has(neighbor) || !idSet.has(neighbor)) continue;
            if (excludeLockedDoors && lockMap.get(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }

    return visited;
}

/**
 * Check that all required materials for a failure are reachable from entry
 * without passing through the failure room. Returns error string or null.
 */
export function checkMaterialReachability(
    failureRoomId: string,
    requiredMaterials: string[],
    itemPlacements: Array<{ id: string; roomId: string; baseItemKey: string }>,
    rooms: RoomLike[],
    entryId: string,
): string | null {
    // Compute rooms reachable from entry (including locked doors for now — Layer 2 doesn't enforce key ordering)
    const reachable = computeReachableRooms(entryId, rooms);

    for (const mat of requiredMaterials) {
        // Find any item with this baseItemKey in a reachable room
        const available = itemPlacements.filter(
            i => i.baseItemKey === mat && reachable.has(i.roomId),
        );
        if (available.length === 0) {
            const reachableList = [...reachable].sort().join(', ');
            return `${failureRoomId} has failure requiring [${requiredMaterials.join(', ')}], but ${mat} is not placed in any reachable room. Reachable rooms: [${reachableList}]`;
        }
    }
    return null;
}

export interface ValidationResult<T> {
    success: boolean;
    value?: T;
    errors?: string[];
    repairs?: string[];
}

export function validationSuccess<T>(value: T, repairs?: string[]): ValidationResult<T> {
    if (repairs && repairs.length > 0) {
        return { success: true, value, repairs };
    }
    return { success: true, value };
}

export function validationFailure<T>(errors: string[]): ValidationResult<T> {
    return { success: false, errors };
}
