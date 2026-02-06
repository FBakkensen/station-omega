import type { Room, RoomSkeleton } from './types.js';

/**
 * Returns IDs of rooms connected to the given room.
 */
export function getAdjacentRooms(roomId: string, rooms: Map<string, Room>): string[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    return [...room.connections];
}

/**
 * BFS shortest path from one room to another.
 * Returns array of room IDs including start and end, or null if unreachable.
 */
export function bfsPath(from: string, to: string, rooms: Map<string, Room>): string[] | null {
    if (from === to) return [from];
    if (!rooms.has(from) || !rooms.has(to)) return null;

    const visited = new Set<string>([from]);
    const queue: string[][] = [[from]];

    while (queue.length > 0) {
        const path = queue.shift();
        if (!path) break;
        const current = path[path.length - 1];
        const room = rooms.get(current);
        if (!room) continue;

        for (const neighbor of room.connections) {
            if (neighbor === to) return [...path, neighbor];
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }

    return null;
}

/**
 * BFS from the first room to ensure all rooms are reachable via connections.
 */
export function validateConnectivity(rooms: RoomSkeleton[]): boolean {
    if (rooms.length === 0) return true;

    const idSet = new Set(rooms.map((r) => r.id));
    const connectionMap = new Map<string, string[]>();
    for (const room of rooms) {
        connectionMap.set(room.id, room.connections);
    }

    const visited = new Set<string>();
    const queue: string[] = [rooms[0].id];
    visited.add(rooms[0].id);

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const connections = connectionMap.get(current) ?? [];
        for (const neighbor of connections) {
            if (idSet.has(neighbor) && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return visited.size === idSet.size;
}

/**
 * BFS from entry room to compute depth (distance) of each room.
 */
export function computeDepths(entryId: string, rooms: RoomSkeleton[]): Map<string, number> {
    const connectionMap = new Map<string, string[]>();
    const idSet = new Set<string>();
    for (const room of rooms) {
        connectionMap.set(room.id, room.connections);
        idSet.add(room.id);
    }

    const depths = new Map<string, number>();
    if (!idSet.has(entryId)) return depths;

    depths.set(entryId, 0);
    const queue: string[] = [entryId];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const currentDepth = depths.get(current) ?? 0;
        const connections = connectionMap.get(current) ?? [];
        for (const neighbor of connections) {
            if (idSet.has(neighbor) && !depths.has(neighbor)) {
                depths.set(neighbor, currentDepth + 1);
                queue.push(neighbor);
            }
        }
    }

    return depths;
}

/**
 * Check if 'to' is reachable from 'from' via BFS.
 */
export function isReachable(from: string, to: string, rooms: RoomSkeleton[]): boolean {
    if (from === to) return true;

    const connectionMap = new Map<string, string[]>();
    const idSet = new Set<string>();
    for (const room of rooms) {
        connectionMap.set(room.id, room.connections);
        idSet.add(room.id);
    }

    if (!idSet.has(from) || !idSet.has(to)) return false;

    const visited = new Set<string>([from]);
    const queue: string[] = [from];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        const connections = connectionMap.get(current) ?? [];
        for (const neighbor of connections) {
            if (neighbor === to) return true;
            if (idSet.has(neighbor) && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return false;
}

/**
 * Returns room IDs that have only 1 connection (dead ends).
 */
export function getDeadEnds(rooms: RoomSkeleton[]): string[] {
    return rooms.filter((r) => r.connections.length === 1).map((r) => r.id);
}
