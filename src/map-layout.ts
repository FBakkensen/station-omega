import type { MapLayout, Room } from './types.js';

// Small deterministic RNG for layout jitter (LCG).
class SeededRng {
    private state: number;

    constructor(seed: number) {
        // Keep it in the same safe integer space as the rest of the codebase.
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

    shuffle<T>(arr: T[]): T[] {
        const out = [...arr];
        for (let i = out.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }
}

function getMaxDepth(rooms: Map<string, Room>): number {
    let max = 0;
    for (const r of rooms.values()) max = Math.max(max, r.depth);
    return max;
}

/**
 * Generate a deterministic 2D layout for the station graph.
 *
 * Goals:
 * - Always respects topology (connections are rendered from data; this only places nodes)
 * - "Organic" variance per run (seeded ordering + small jitter)
 * - Blueprint-friendly (mostly depth -> x-axis)
 */
export function generateMapLayout(rooms: Map<string, Room>, seed: number, entryRoomId: string): MapLayout {
    const rng = new SeededRng(seed);

    // These spacings are in "character cells" (not terminal pixels).
    // Wider DX reduces corridor collisions at the cost of map width.
    const DX = 6;
    const DY = 3;

    const maxDepth = getMaxDepth(rooms);
    const byDepth = new Map<number, string[]>();
    for (const [id, r] of rooms.entries()) {
        const arr = byDepth.get(r.depth) ?? [];
        arr.push(id);
        byDepth.set(r.depth, arr);
    }

    // Seeded but stable order within each depth.
    for (const [d, ids] of byDepth.entries()) {
        ids.sort((a, b) => a.localeCompare(b));
        byDepth.set(d, rng.shuffle(ids));
    }

    const positions = new Map<string, { x: number; y: number }>();
    const used = new Set<string>(); // key: `${x},${y}`

    const place = (id: string, x: number, y: number): void => {
        positions.set(id, { x, y });
        used.add(`${String(x)},${String(y)}`);
    };

    // Anchor entry at (0,0) if available; otherwise anchor the lowest-depth room.
    const entryId = rooms.has(entryRoomId)
        ? entryRoomId
        : [...rooms.entries()].sort((a, b) => a[1].depth - b[1].depth)[0]?.[0] ?? entryRoomId;
    place(entryId, 0, 0);

    // Depth-by-depth placement using parents to guide y.
    for (let depth = 0; depth <= maxDepth; depth++) {
        const ids = byDepth.get(depth) ?? [];
        for (const id of ids) {
            if (positions.has(id)) continue;
            const room = rooms.get(id);
            if (!room) continue;

            const x = depth * DX;

            // Preferred y is based on connected rooms at lower depth (if any).
            const parentYs: number[] = [];
            for (const nId of room.connections) {
                const n = rooms.get(nId);
                const nPos = positions.get(nId);
                if (n && nPos && n.depth < room.depth) parentYs.push(nPos.y);
            }
            const baseY = parentYs.length > 0
                ? Math.round(parentYs.reduce((a, b) => a + b, 0) / parentYs.length)
                : 0;

            // Add a tiny bit of organic drift while keeping alignment with DY.
            const driftSteps = rng.nextInt(-1, 1);
            let y = Math.round((baseY + driftSteps * DY) / DY) * DY;

            // Resolve collisions by nudging in an alternating pattern.
            if (used.has(`${String(x)},${String(y)}`)) {
                // Bound the search to avoid accidental infinite loops if something goes wrong.
                let placed = false;
                for (let step = 1; step <= 200; step++) {
                    const up = y - step * DY;
                    const down = y + step * DY;
                    if (!used.has(`${String(x)},${String(up)}`)) { y = up; placed = true; break; }
                    if (!used.has(`${String(x)},${String(down)}`)) { y = down; placed = true; break; }
                }
                if (!placed) {
                    // Extremely unlikely with our small room counts, but fail loudly if it happens.
                    throw new Error(`Map layout collision resolution failed at depth=${String(depth)} for room=${id}`);
                }
            }

            place(id, x, y);
        }
    }

    // Bounds
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const p of positions.values()) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }

    return {
        seed,
        positions,
        bounds: { minX, maxX, minY, maxY },
        scaleHint: { dx: DX, dy: DY },
    };
}
