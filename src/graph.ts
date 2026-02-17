import type { RoomSkeleton } from './types.js';

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
