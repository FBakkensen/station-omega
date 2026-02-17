import { bg, bold, fg } from '@opentui/core';
import type { TextChunk } from '@opentui/core';
import type { GameState, GeneratedStation, MapLayout, Room, RoomArchetype } from './types.js';

// ─── Room Block Constants ──────────────────────────────────────────────────

const ROOM_HALF_W = 3;   // half-width: room block is 7 chars (center ± 3)
const ROOM_HALF_H = 1;   // half-height: room block is 3 rows (center ± 1)

const ARCHETYPE_ICON: Record<RoomArchetype, string> = {
    entry:      '\u25B6',  // ▶
    escape:     '\u2606',  // ☆
    medical:    '\u271A',  // ✚
    reactor:    '\u2622',  // ☢
    command:    '\u2605',  // ★
    science:    '\u269B',  // ⚛
    cargo:      '\u25A3',  // ▣
    quarters:   '\u2302',  // ⌂
    utility:    '\u2699',  // ⚙
    restricted: '\u2298',  // ⊘
};

// ─── Color Palette ─────────────────────────────────────────────────────────

const ROOM_BG: Record<RoomArchetype, string> = {
    entry:      '#0a2e1a',
    escape:     '#2e2a0a',
    medical:    '#0a2e2a',
    reactor:    '#2e0a0a',
    command:    '#0a1a2e',
    science:    '#0a1a28',
    cargo:      '#2a2a0a',
    quarters:   '#1a1a1e',
    utility:    '#121216',
    restricted: '#2e1a0a',
};

const ROOM_FG: Record<RoomArchetype, string> = {
    entry:      '#00ff88',
    escape:     '#ffcc00',
    medical:    '#00ddaa',
    reactor:    '#ff4444',
    command:    '#00e5ff',
    science:    '#8abfff',
    cargo:      '#ddaa00',
    quarters:   '#8890a0',
    utility:    '#5a6a7a',
    restricted: '#ff8844',
};

const PLAYER_BG = '#0a2a3a';
const PLAYER_FG = '#00e5ff';

const CORRIDOR_COLOR = '#2a4a6a';
const STUB_COLOR = '#1a2a3a';

// ─── Typed Cell Grid ───────────────────────────────────────────────────────

type CellRole =
    | 'empty'
    | 'corridor'
    | 'junction'
    | 'room'
    | 'player'
    | 'failure'
    | 'loot'
    | 'objective'
    | 'unknown'
    | 'locked';

interface MapCell {
    char: string;
    role: CellRole;
    archetype?: RoomArchetype;
    stub?: boolean;
}

type CellPriority = 0 | 1 | 2 | 3;

const EMPTY_CELL: MapCell = { char: ' ', role: 'empty' };

// ─── Helpers ───────────────────────────────────────────────────────────────

function hashString(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function hasActiveFailure(room: Room): boolean {
    return room.systemFailures.some(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');
}

// ─── Rounded Corner Helpers ────────────────────────────────────────────────

const CORNER_CHARS = new Set(['╭', '╮', '╯', '╰']);

/** Corner for horizontal-first L-turn: go horizontal then vertical. */
function getCornerHV(sx: number, sy: number): string {
    if (sx > 0 && sy > 0) return '╮'; // right then down
    if (sx > 0 && sy < 0) return '╯'; // right then up
    if (sx < 0 && sy > 0) return '╭'; // left then down
    return '╰'; // left then up
}

/** Corner for vertical-first L-turn: go vertical then horizontal. */
function getCornerVH(sx: number, sy: number): string {
    if (sx > 0 && sy > 0) return '╰'; // down then right
    if (sx > 0 && sy < 0) return '╭'; // up then right
    if (sx < 0 && sy > 0) return '╯'; // down then left
    return '╮'; // up then left
}

// ─── Room Block Placement ──────────────────────────────────────────────────

interface RoomBlockInfo {
    gx: number;
    gy: number;
    isPlayer: boolean;
    archetype: RoomArchetype;
}

function placeRoomBlock(
    set: (x: number, y: number, cell: MapCell, prio: CellPriority) => void,
    gx: number,
    gy: number,
    archetype: RoomArchetype,
    isPlayer: boolean,
): void {
    const role: CellRole = isPlayer ? 'player' : 'room';
    const arch: RoomArchetype | undefined = isPlayer ? undefined : archetype;
    const makeCell = (char: string): MapCell => ({ char, role, archetype: arch });

    // Border characters: player uses double-line, normal uses rounded
    const [tl, hz, tr, vt, bl, br] = isPlayer
        ? ['╔', '═', '╗', '║', '╚', '╝']
        : ['╭', '─', '╮', '│', '╰', '╯'];

    // Interior label (5 chars between left and right borders)
    const label = isPlayer ? '  \u25CE  ' : `  ${ARCHETYPE_ICON[archetype]}  `;

    // Top row
    set(gx - ROOM_HALF_W, gy - ROOM_HALF_H, makeCell(tl), 3);
    for (let x = gx - ROOM_HALF_W + 1; x < gx + ROOM_HALF_W; x++) {
        set(x, gy - ROOM_HALF_H, makeCell(hz), 3);
    }
    set(gx + ROOM_HALF_W, gy - ROOM_HALF_H, makeCell(tr), 3);

    // Middle row (borders + label)
    set(gx - ROOM_HALF_W, gy, makeCell(vt), 3);
    for (let i = 0; i < 5; i++) {
        set(gx - ROOM_HALF_W + 1 + i, gy, makeCell(label[i]), 3);
    }
    set(gx + ROOM_HALF_W, gy, makeCell(vt), 3);

    // Bottom row
    set(gx - ROOM_HALF_W, gy + ROOM_HALF_H, makeCell(bl), 3);
    for (let x = gx - ROOM_HALF_W + 1; x < gx + ROOM_HALF_W; x++) {
        set(x, gy + ROOM_HALF_H, makeCell(hz), 3);
    }
    set(gx + ROOM_HALF_W, gy + ROOM_HALF_H, makeCell(br), 3);
}

// ─── Corridor Drawing (Box-Drawing) ─────────────────────────────────────────

function drawLine(
    set: (x: number, y: number, cell: MapCell, prio: CellPriority) => void,
    get: (x: number, y: number) => MapCell,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    dir: 'h' | 'v',
): void {
    const ch = dir === 'h' ? '─' : '│';
    const cross = dir === 'h' ? '│' : '─';

    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));

    for (let i = 0; i <= steps; i++) {
        const existing = get(x, y);
        if (existing.role === 'empty' || (existing.role === 'corridor' && existing.char === ch)) {
            set(x, y, { char: ch, role: 'corridor' }, 1);
        } else if (
            (existing.role === 'corridor' && (existing.char === cross || CORNER_CHARS.has(existing.char))) ||
            existing.role === 'junction'
        ) {
            set(x, y, { char: '┼', role: 'junction' }, 1);
        }
        x += dx;
        y += dy;
    }
}

function routeCorridor(
    set: (x: number, y: number, cell: MapCell, prio: CellPriority) => void,
    get: (x: number, y: number) => MapCell,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    preferHV: boolean,
): void {
    const dx = bx - ax;
    const dy = by - ay;

    // Straight corridors
    if (dy === 0) { drawLine(set, get, ax, ay, bx, by, 'h'); return; }
    if (dx === 0) { drawLine(set, get, ax, ay, bx, by, 'v'); return; }

    const sx = Math.sign(dx);
    const sy = Math.sign(dy);

    if (preferHV) {
        // Horizontal first, then vertical. Turn point at (bx, ay).
        const prevRole = get(bx, ay).role;
        drawLine(set, get, ax, ay, bx, ay, 'h');
        drawLine(set, get, bx, ay, bx, by, 'v');
        // Place rounded corner unless there was already a corridor/junction here
        if (prevRole === 'empty') {
            set(bx, ay, { char: getCornerHV(sx, sy), role: 'corridor' }, 1);
        }
    } else {
        // Vertical first, then horizontal. Turn point at (ax, by).
        const prevRole = get(ax, by).role;
        drawLine(set, get, ax, ay, ax, by, 'v');
        drawLine(set, get, ax, by, bx, by, 'h');
        if (prevRole === 'empty') {
            set(ax, by, { char: getCornerVH(sx, sy), role: 'corridor' }, 1);
        }
    }
}

// ─── Post-Process Connectors ───────────────────────────────────────────────

function addConnectors(
    grid: MapCell[][],
    prio: number[][],
    gridHeight: number,
    gridWidth: number,
    rooms: RoomBlockInfo[],
): void {
    const inBounds = (x: number, y: number): boolean =>
        y >= 0 && y < gridHeight && x >= 0 && x < gridWidth;

    const isCorridorAt = (x: number, y: number): boolean => {
        if (!inBounds(x, y)) return false;
        const cell = grid[y][x];
        return cell.role === 'corridor' || cell.role === 'junction';
    };

    for (const room of rooms) {
        const { gx, gy, isPlayer, archetype } = room;
        const role: CellRole = isPlayer ? 'player' : 'room';
        const arch: RoomArchetype | undefined = isPlayer ? undefined : archetype;

        // Connector characters: double-line for player, single for normal
        const [connL, connR, connT, connB] = isPlayer
            ? ['╣', '╠', '╩', '╦']
            : ['┤', '├', '┴', '┬'];

        // Left border — middle row only (corners excluded)
        {
            const bx = gx - ROOM_HALF_W;
            if (inBounds(bx, gy) && isCorridorAt(bx - 1, gy)) {
                grid[gy][bx] = { char: connL, role, archetype: arch };
                prio[gy][bx] = 3;
            }
        }

        // Right border — middle row only
        {
            const bx = gx + ROOM_HALF_W;
            if (inBounds(bx, gy) && isCorridorAt(bx + 1, gy)) {
                grid[gy][bx] = { char: connR, role, archetype: arch };
                prio[gy][bx] = 3;
            }
        }

        // Top border — non-corner cells
        for (let x = gx - ROOM_HALF_W + 1; x < gx + ROOM_HALF_W; x++) {
            const by = gy - ROOM_HALF_H;
            if (inBounds(x, by) && isCorridorAt(x, by - 1)) {
                grid[by][x] = { char: connT, role, archetype: arch };
                prio[by][x] = 3;
            }
        }

        // Bottom border — non-corner cells
        for (let x = gx - ROOM_HALF_W + 1; x < gx + ROOM_HALF_W; x++) {
            const by = gy + ROOM_HALF_H;
            if (inBounds(x, by) && isCorridorAt(x, by + 1)) {
                grid[by][x] = { char: connB, role, archetype: arch };
                prio[by][x] = 3;
            }
        }
    }
}

// ─── Marker Placement ──────────────────────────────────────────────────────

function tryPlaceMarker(
    set: (x: number, y: number, cell: MapCell, prio: CellPriority) => void,
    get: (x: number, y: number) => MapCell,
    gx: number,
    gy: number,
    ch: string,
    role: CellRole,
): void {
    // Candidates outside the room block edges
    const candidates: Array<[number, number]> = [
        [gx + ROOM_HALF_W + 1, gy],
        [gx - ROOM_HALF_W - 1, gy],
        [gx, gy - ROOM_HALF_H - 1],
        [gx, gy + ROOM_HALF_H + 1],
    ];
    for (const [mx, my] of candidates) {
        if (get(mx, my).role === 'empty') {
            set(mx, my, { char: ch, role }, 2);
            return;
        }
    }
}

// ─── Cell → TextChunk ──────────────────────────────────────────────────────

function cellToChunk(cell: MapCell): TextChunk {
    if (cell.role === 'empty') return fg('#000000')(' ');

    // Room block cells (border, interior, connector) — bg-colored
    if (cell.role === 'room' && cell.archetype) {
        return bg(ROOM_BG[cell.archetype])(fg(ROOM_FG[cell.archetype])(cell.char));
    }

    // Player room cells — bold, bright bg
    if (cell.role === 'player') {
        return bold(bg(PLAYER_BG)(fg(PLAYER_FG)(cell.char)));
    }

    // Corridors and junctions
    if (cell.role === 'corridor' || cell.role === 'junction') {
        const color = cell.stub === true ? STUB_COLOR : CORRIDOR_COLOR;
        return fg(color)(cell.char);
    }

    // Markers
    if (cell.role === 'failure')   return bold(fg('#ff8844')(cell.char));
    if (cell.role === 'loot')      return bold(fg('#ffcc00')(cell.char));
    if (cell.role === 'objective') return bold(fg('#00ff88')(cell.char));
    if (cell.role === 'unknown')   return fg('#5a6a7a')(cell.char);
    if (cell.role === 'locked')    return bold(fg('#ff8844')(cell.char));

    return fg('#5a6a7a')(cell.char);
}

// ─── Grid Builder ──────────────────────────────────────────────────────────

function buildGrid(
    station: GeneratedStation,
    state: Pick<GameState, 'roomsVisited' | 'currentRoom' | 'itemsTaken'>,
    layout: MapLayout,
): MapCell[][] {
    const margin = 5;
    const { minX, maxX, minY, maxY } = layout.bounds;

    // 2x scaling creates space for 7×3 room blocks + corridors
    const width  = ((maxX - minX) * 2) + margin * 2 + 1;
    const height = ((maxY - minY) * 2) + margin * 2 + 1;

    const grid: MapCell[][] = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => ({ ...EMPTY_CELL })),
    );
    const prio: number[][] = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => 0),
    );

    const toGrid = (x: number, y: number): { gx: number; gy: number } => ({
        gx: ((x - minX) * 2) + margin,
        gy: ((y - minY) * 2) + margin,
    });

    const inBounds = (x: number, y: number): boolean =>
        y >= 0 && y < height && x >= 0 && x < width;

    const get = (x: number, y: number): MapCell =>
        inBounds(x, y) ? grid[y][x] : EMPTY_CELL;

    const set = (x: number, y: number, cell: MapCell, p: CellPriority): void => {
        if (!inBounds(x, y)) return;
        if (p >= (prio[y][x] as CellPriority)) {
            grid[y][x] = cell;
            prio[y][x] = p;
        }
    };

    // ── 1) Draw corridors (center-to-center, L-shapes with rounded corners) ──

    const visited = state.roomsVisited;
    const edgeSeen = new Set<string>();
    const edgePrefer = (a: string, b: string): boolean => {
        const key = [a, b].sort().join('<->');
        return (hashString(`${String(layout.seed)}:${key}`) % 2) === 0;
    };

    for (const [id, room] of station.rooms.entries()) {
        if (!visited.has(id)) continue;
        const aPos = layout.positions.get(id);
        if (!aPos) continue;

        for (const nid of room.connections) {
            const edgeKey = [id, nid].sort().join('|');
            if (edgeSeen.has(edgeKey)) continue;
            edgeSeen.add(edgeKey);

            if (!visited.has(nid)) continue;
            const bPos = layout.positions.get(nid);
            if (!bPos) continue;

            const a = toGrid(aPos.x, aPos.y);
            const b = toGrid(bPos.x, bPos.y);
            routeCorridor(set, get, a.gx, a.gy, b.gx, b.gy, edgePrefer(id, nid));
        }
    }

    // ── 2) Draw stubs (from room edge outward to unvisited neighbors) ─────────

    for (const [id, room] of station.rooms.entries()) {
        if (!visited.has(id)) continue;
        const aPos = layout.positions.get(id);
        if (!aPos) continue;
        const a = toGrid(aPos.x, aPos.y);

        for (const nid of room.connections) {
            if (visited.has(nid)) continue;
            const bPos = layout.positions.get(nid);
            if (!bPos) continue;
            const b = toGrid(bPos.x, bPos.y);

            const ddx = b.gx - a.gx;
            const ddy = b.gy - a.gy;
            const useH = Math.abs(ddx) >= Math.abs(ddy);
            const sx = Math.sign(ddx);
            const sy = Math.sign(ddy);

            // Start outside the room block edge
            const startOffset = useH ? ROOM_HALF_W + 1 : ROOM_HALF_H + 1;
            const stubLen = 3;

            for (let i = 0; i < stubLen; i++) {
                const x = a.gx + (useH ? sx * (startOffset + i) : 0);
                const y = a.gy + (useH ? 0 : sy * (startOffset + i));
                // Don't draw stubs through existing corridors between visited rooms
                const existing = get(x, y);
                if ((existing.role === 'corridor' && existing.stub !== true) || existing.role === 'junction') {
                    break;
                }
                if (i < stubLen - 1) {
                    const ch = useH ? '─' : '│';
                    set(x, y, { char: ch, role: 'corridor', stub: true }, 1);
                } else {
                    const targetRoom = station.rooms.get(nid);
                    const locked = Boolean(targetRoom?.lockedBy);
                    set(x, y, { char: locked ? '\u2297' : '\u25CC', role: locked ? 'locked' : 'unknown' }, 1);
                }
            }
        }
    }

    // ── 3) Place room blocks (priority 3 — overwrites corridor cells inside) ──

    const roomBlocks: RoomBlockInfo[] = [];
    for (const [id, room] of station.rooms.entries()) {
        if (!visited.has(id)) continue;
        const p = layout.positions.get(id);
        if (!p) continue;
        const { gx, gy } = toGrid(p.x, p.y);
        const isPlayer = id === state.currentRoom;

        placeRoomBlock(set, gx, gy, room.archetype, isPlayer);
        roomBlocks.push({ gx, gy, isPlayer, archetype: room.archetype });
    }

    // ── 4) Post-process connectors at room borders ────────────────────────────

    addConnectors(grid, prio, height, width, roomBlocks);

    // ── 5) Place markers (priority 2 — outside room blocks) ──────────────────

    for (const [id, room] of station.rooms.entries()) {
        if (!visited.has(id)) continue;
        const p = layout.positions.get(id);
        if (!p) continue;
        const { gx, gy } = toGrid(p.x, p.y);

        if (room.isObjectiveRoom) tryPlaceMarker(set, get, gx, gy, '\u2295', 'objective');
        if (room.loot.some(itemId => !state.itemsTaken.has(itemId))) tryPlaceMarker(set, get, gx, gy, '\u25C6', 'loot');
        if (hasActiveFailure(room)) tryPlaceMarker(set, get, gx, gy, '\u26A0', 'failure');
    }

    return grid;
}

// ─── Styled Legend ──────────────────────────────────────────────────────────

export function buildMapLegend(): TextChunk[] {
    const dim = '#5a6a7a';
    return [
        bold(bg(PLAYER_BG)(fg(PLAYER_FG)(' \u25CE '))), fg(dim)(' you  '),
        bg(ROOM_BG.entry)(fg(ROOM_FG.entry)('\u25B6')), fg(dim)(' entry  '),
        bg(ROOM_BG.escape)(fg(ROOM_FG.escape)('\u2606')), fg(dim)(' escape  '),
        bold(fg('#ff8844')('\u26A0')), fg(dim)(' failure  '),
        bold(fg('#ffcc00')('\u25C6')), fg(dim)(' loot  '),
        bold(fg('#00ff88')('\u2295')), fg(dim)(' objective  '),
        fg('#5a6a7a')('\u25CC'), fg(dim)(' unknown  '),
        bold(fg('#ff8844')('\u2297')), fg(dim)(' locked'),
    ];
}

// ─── Main Exports ──────────────────────────────────────────────────────────

/**
 * Render a styled map as TextChunk[].
 *
 * Does NOT include title or hint text (the modal handles those).
 * Returns the grid rows + a trailing legend line.
 */
export function renderMapStyled(
    station: GeneratedStation,
    state: Pick<GameState, 'roomsVisited' | 'currentRoom' | 'itemsTaken'>,
    layout: MapLayout,
): TextChunk[] {
    const grid = buildGrid(station, state, layout);

    // Trim trailing empty rows
    while (grid.length > 0) {
        const lastRow = grid[grid.length - 1];
        if (lastRow.every(cell => cell.role === 'empty')) {
            grid.pop();
        } else {
            break;
        }
    }

    const chunks: TextChunk[] = [];

    for (const row of grid) {
        // Trim trailing empty cells per row
        let lastNonEmpty = row.length - 1;
        while (lastNonEmpty >= 0 && row[lastNonEmpty].role === 'empty') {
            lastNonEmpty--;
        }

        for (let x = 0; x <= lastNonEmpty; x++) {
            chunks.push(cellToChunk(row[x]));
        }
        chunks.push(fg('#000000')('\n'));
    }

    // Legend
    chunks.push(fg('#000000')('\n'));
    chunks.push(...buildMapLegend());

    return chunks;
}

export interface RenderMapOptions {
    title?: string;
    showLegend?: boolean;
}

/**
 * Backward-compatible plain-text map render.
 * Delegates to the styled grid builder but strips styling to plain characters.
 */
export function renderMapText(
    station: GeneratedStation,
    state: Pick<GameState, 'roomsVisited' | 'currentRoom' | 'itemsTaken'>,
    layout: MapLayout,
    opts: RenderMapOptions = {},
): string {
    const grid = buildGrid(station, state, layout);

    const lines: string[] = [];
    const title = opts.title ?? 'STATION MAP (VISITED)';
    lines.push(title);
    lines.push('');

    for (const row of grid) {
        lines.push(row.map(c => c.char).join('').replace(/\s+$/u, ''));
    }

    if (opts.showLegend !== false) {
        lines.push('');
        lines.push('Legend: \u25CE you  \u25B6 entry  \u2606 escape  \u26A0 failure  \u25C6 loot  \u2295 objective  \u25CC unknown  \u2297 locked');
        lines.push('Hint: F1 map  F2 mission  Esc close');
    }

    while (lines.length > 4 && lines[lines.length - 1] === '' && lines[lines.length - 2] === '') {
        lines.pop();
    }

    return lines.join('\n');
}
