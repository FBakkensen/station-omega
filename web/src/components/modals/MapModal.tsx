import { useMemo } from 'react';
import { COLORS } from '../../styles/theme';

interface MapRoom {
  id: string;
  name: string;
  archetype: string;
  connections: string[];
  depth: number;
}

interface MapModalProps {
  rooms: Record<string, MapRoom>;
  currentRoomId: string;
  visitedRoomIds: string[];
  onClose: () => void;
}

type RoomVisibility = 'current' | 'visited' | 'adjacent-unvisited';

/** Simple deterministic hash for seeded layout. */
function hashSeed(rooms: Record<string, MapRoom>): number {
  let hash = 5381;
  for (const id of Object.keys(rooms).sort()) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
    }
  }
  return Math.abs(hash);
}

/** Archetype → icon character map. */
const ARCHETYPE_ICONS: Record<string, string> = {
  bridge: '⌘',
  engineering: '⚙',
  medical: '✚',
  cargo: '▣',
  lab: '⚗',
  quarters: '⌂',
  corridor: '═',
  airlock: '◈',
  reactor: '☢',
  observation: '◉',
  comms: '⚡',
  armory: '⚔',
  storage: '▤',
  maintenance: '⚒',
};

function getIcon(archetype: string): string {
  return ARCHETYPE_ICONS[archetype] ?? '▪';
}

function formatArchetype(archetype: string): string {
  return archetype
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sizing constants for dynamic room boxes. */
const CHAR_WIDTH = 6; // px per char at fontSize 10, monospace
const RECT_PAD_X = 16; // 8px padding each side inside rect
const MIN_RECT_WIDTH = 80;
const COLUMN_GAP = 30; // gap between column right-edge and next column left-edge

interface RoomMetric {
  displayText: string;
  rectWidth: number;
}

function computeRoomMetrics(
  rooms: Record<string, MapRoom>,
  visibleRoomIds: string[],
  roomVisibility: Map<string, RoomVisibility>,
): Map<string, RoomMetric> {
  const metrics = new Map<string, RoomMetric>();
  for (const id of visibleRoomIds) {
    const room = rooms[id];
    const vis = roomVisibility.get(id);
    const isUnvisited = vis === 'adjacent-unvisited';
    const displayText = isUnvisited
      ? room.name
      : `${getIcon(room.archetype)} ${room.name}`;
    const textWidth = displayText.length * CHAR_WIDTH;
    const rectWidth = Math.max(MIN_RECT_WIDTH, textWidth + RECT_PAD_X);
    metrics.set(id, { displayText, rectWidth });
  }
  return metrics;
}

/**
 * Generate a force-directed-inspired layout for SVG rendering.
 * Groups rooms by depth on the X axis, spreads vertically within each group.
 */
function computeLayout(
  rooms: Record<string, MapRoom>,
  seed: number,
  columnWidths: Map<number, number>,
) {
  const roomIds = Object.keys(rooms);
  const byDepth = new Map<number, string[]>();

  for (const id of roomIds) {
    const room = rooms[id];
    const arr = byDepth.get(room.depth) ?? [];
    arr.push(id);
    byDepth.set(room.depth, arr);
  }

  // Seeded sort within each depth for determinism
  let rngState = seed % 2147483647;
  if (rngState <= 0) rngState += 2147483646;
  const nextRng = () => {
    rngState = (rngState * 16807) % 2147483647;
    return (rngState - 1) / 2147483646;
  };

  for (const ids of byDepth.values()) {
    ids.sort((a, b) => a.localeCompare(b));
    // Fisher-Yates shuffle with seeded RNG
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(nextRng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }

  const DY = 80;
  const positions = new Map<string, { x: number; y: number }>();

  const maxDepth = Math.max(...[...byDepth.keys()]);

  // Cumulative X positioning based on per-column max widths
  let cumulativeX = 0;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const ids = byDepth.get(depth) ?? [];
    const colWidth = columnWidths.get(depth) ?? MIN_RECT_WIDTH;
    const x = cumulativeX + colWidth / 2;

    const groupHeight = (ids.length - 1) * DY;
    const startY = -groupHeight / 2 + 250; // Center vertically around 250

    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x, y: startY + i * DY });
    }

    cumulativeX += colWidth + COLUMN_GAP;
  }

  return { positions };
}

export function MapModal({ rooms, currentRoomId, visitedRoomIds, onClose }: MapModalProps) {
  const seed = useMemo(() => hashSeed(rooms), [rooms]);

  const {
    visibleRoomIds,
    roomVisibility,
    connections,
    visibleArchetypes,
    hasCurrent,
    hasVisited,
    hasAdjacentUnvisited,
  } = useMemo(() => {
    const hasRoom = (roomId: string) => Object.prototype.hasOwnProperty.call(rooms, roomId);
    const visitedSet = new Set(visitedRoomIds.filter((roomId) => hasRoom(roomId)));
    if (hasRoom(currentRoomId)) {
      visitedSet.add(currentRoomId);
    }

    const adjacentUnvisited = new Set<string>();
    for (const roomId of visitedSet) {
      const room = rooms[roomId];
      for (const neighborId of room.connections) {
        if (hasRoom(neighborId) && !visitedSet.has(neighborId)) {
          adjacentUnvisited.add(neighborId);
        }
      }
    }

    const visibleSet = new Set<string>([...visitedSet, ...adjacentUnvisited]);

    const visibility = new Map<string, RoomVisibility>();
    for (const roomId of visibleSet) {
      if (roomId === currentRoomId) {
        visibility.set(roomId, 'current');
      } else if (visitedSet.has(roomId)) {
        visibility.set(roomId, 'visited');
      } else {
        visibility.set(roomId, 'adjacent-unvisited');
      }
    }

    const archetypes = new Set<string>();
    for (const roomId of visibleSet) {
      const room = rooms[roomId];
      const state = visibility.get(roomId);
      if (state === 'current' || state === 'visited') {
        archetypes.add(room.archetype);
      }
    }

    const dedupedConnections: Array<{ from: string; to: string }> = [];
    const seen = new Set<string>();
    for (const roomId of visibleSet) {
      const room = rooms[roomId];
      for (const neighborId of room.connections) {
        if (!visibleSet.has(neighborId) || !hasRoom(neighborId)) continue;
        const key = [roomId, neighborId].sort().join('-');
        if (!seen.has(key)) {
          seen.add(key);
          dedupedConnections.push({ from: roomId, to: neighborId });
        }
      }
    }

    return {
      visibleRoomIds: [...visibleSet],
      roomVisibility: visibility,
      connections: dedupedConnections,
      visibleArchetypes: [...archetypes].sort(),
      hasCurrent: visibleSet.has(currentRoomId),
      hasVisited: [...visibleSet].some((roomId) => visibility.get(roomId) === 'visited'),
      hasAdjacentUnvisited: [...visibleSet].some(
        (roomId) => visibility.get(roomId) === 'adjacent-unvisited',
      ),
    };
  }, [rooms, currentRoomId, visitedRoomIds]);

  const roomMetrics = useMemo(
    () => computeRoomMetrics(rooms, visibleRoomIds, roomVisibility),
    [rooms, visibleRoomIds, roomVisibility],
  );

  const columnWidths = useMemo(() => {
    const widths = new Map<number, number>();
    for (const id of visibleRoomIds) {
      const room = rooms[id];
      const metric = roomMetrics.get(id);
      if (!metric) continue;
      const prev = widths.get(room.depth) ?? 0;
      widths.set(room.depth, Math.max(prev, metric.rectWidth));
    }
    return widths;
  }, [rooms, visibleRoomIds, roomMetrics]);

  const { positions } = useMemo(
    () => computeLayout(rooms, seed, columnWidths),
    [rooms, seed, columnWidths],
  );

  const bounds = useMemo(() => {
    const PADDING_Y = 60;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const roomId of visibleRoomIds) {
      const pos = positions.get(roomId);
      const metric = roomMetrics.get(roomId);
      if (!pos || !metric) continue;
      const halfW = metric.rectWidth / 2;
      minX = Math.min(minX, pos.x - halfW);
      maxX = Math.max(maxX, pos.x + halfW);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return { minX: 0, maxX: 320, minY: 0, maxY: 220 };
    }

    return {
      minX: minX - 20,
      maxX: maxX + 20,
      minY: minY - PADDING_Y,
      maxY: maxY + PADDING_Y,
    };
  }, [positions, visibleRoomIds, roomMetrics]);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-omega-border bg-omega-panel max-w-4xl max-h-[80vh] overflow-auto p-4"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-omega-title text-sm uppercase tracking-wider">Station Map</h2>
          <button
            onClick={onClose}
            className="text-omega-dim hover:text-omega-text text-sm"
          >
            [ESC] Close
          </button>
        </div>

        <svg
          viewBox={`${String(bounds.minX)} ${String(bounds.minY)} ${String(width)} ${String(height)}`}
          width={width}
          height={height}
          className="w-full"
          style={{ minWidth: Math.min(width, 1200) }}
        >
          {/* Connection lines */}
          {connections.map(({ from, to }) => {
            const p1 = positions.get(from);
            const p2 = positions.get(to);
            if (!p1 || !p2) return null;
            const fromVisibility = roomVisibility.get(from);
            const toVisibility = roomVisibility.get(to);
            const isStrongConnection =
              (fromVisibility === 'current' || fromVisibility === 'visited') &&
              (toVisibility === 'current' || toVisibility === 'visited');
            return (
              <line
                key={`${from}-${to}`}
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke={isStrongConnection ? COLORS.border : '#33435f'}
                strokeWidth="1.5"
                strokeDasharray={isStrongConnection ? undefined : '4 4'}
              />
            );
          })}

          {/* Room nodes */}
          {visibleRoomIds.map((id) => {
            const pos = positions.get(id);
            const metric = roomMetrics.get(id);
            if (!pos || !metric) return null;

            const visibility = roomVisibility.get(id) ?? 'adjacent-unvisited';
            const isCurrent = visibility === 'current';
            const isVisited = visibility === 'visited';
            const isAdjacentUnvisited = visibility === 'adjacent-unvisited';

            const fill = isCurrent
              ? COLORS.title
              : (isVisited ? '#1e3a5f' : '#0f1420');
            const stroke = isCurrent
              ? COLORS.title
              : (isVisited ? COLORS.border : '#2b3447');
            const textColor = isCurrent
              ? '#000'
              : (isVisited ? COLORS.text : '#8fa0bf');
            const halfW = metric.rectWidth / 2;

            return (
              <g key={id}>
                <rect
                  x={pos.x - halfW}
                  y={pos.y - 20}
                  width={metric.rectWidth}
                  height={40}
                  rx={4}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isCurrent ? 2 : 1}
                />
                <text
                  x={pos.x - halfW + 8}
                  y={pos.y - 4}
                  fill={textColor}
                  fontSize="10"
                  fontFamily="monospace"
                  opacity={isAdjacentUnvisited ? 0.8 : 1}
                >
                  {metric.displayText}
                </text>
                {isCurrent && (
                  <text
                    x={pos.x - halfW + 8}
                    y={pos.y + 12}
                    fill="#000"
                    fontSize="8"
                    fontFamily="monospace"
                  >
                    ► YOU ARE HERE
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-omega-dim">
          {hasCurrent && <span><span style={{ color: COLORS.title }}>■</span> Current</span>}
          {hasVisited && <span><span style={{ color: COLORS.border }}>■</span> Visited</span>}
          {hasAdjacentUnvisited && <span><span style={{ color: '#2b3447' }}>■</span> Adjacent (Unvisited)</span>}
        </div>

        {visibleArchetypes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-omega-dim">
            <span className="text-omega-text">Room types:</span>
            {visibleArchetypes.map((archetype) => (
              <span key={archetype}>
                {getIcon(archetype)} {formatArchetype(archetype)}
              </span>
            ))}
          </div>
        )}

        {hasAdjacentUnvisited && (
          <p className="mt-2 text-xs text-omega-dim">
            Dimmed rooms show only confirmed one-hop exits from explored rooms.
          </p>
        )}
        {visibleRoomIds.length === 0 && (
          <p className="mt-2 text-xs text-omega-dim">
            No map data is available for this run yet.
          </p>
        )}
      </div>
    </div>
  );
}
