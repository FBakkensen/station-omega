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

/**
 * Generate a force-directed-inspired layout for SVG rendering.
 * Groups rooms by depth on the X axis, spreads vertically within each group.
 */
function computeLayout(rooms: Record<string, MapRoom>, seed: number) {
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

  const DX = 140;
  const DY = 80;
  const positions = new Map<string, { x: number; y: number }>();

  const maxDepth = Math.max(...[...byDepth.keys()]);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const ids = byDepth.get(depth) ?? [];
    const x = depth * DX + 80;
    const groupHeight = (ids.length - 1) * DY;
    const startY = -groupHeight / 2 + 250; // Center vertically around 250

    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x, y: startY + i * DY });
    }
  }

  // Compute bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  return { positions, bounds: { minX: minX - 80, maxX: maxX + 80, minY: minY - 60, maxY: maxY + 60 } };
}

export function MapModal({ rooms, currentRoomId, visitedRoomIds, onClose }: MapModalProps) {
  const seed = useMemo(() => hashSeed(rooms), [rooms]);
  const layout = useMemo(() => computeLayout(rooms, seed), [rooms, seed]);

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

  const { positions } = layout;
  const bounds = useMemo(() => {
    const PADDING_X = 80;
    const PADDING_Y = 60;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const roomId of visibleRoomIds) {
      const pos = positions.get(roomId);
      if (!pos) continue;
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return { minX: 0, maxX: 320, minY: 0, maxY: 220 };
    }

    return {
      minX: minX - PADDING_X,
      maxX: maxX + PADDING_X,
      minY: minY - PADDING_Y,
      maxY: maxY + PADDING_Y,
    };
  }, [positions, visibleRoomIds]);

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
          width={Math.min(width, 800)}
          height={Math.min(height, 500)}
          className="w-full"
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
            const room = rooms[id];
            const pos = positions.get(id);
            if (!pos) return null;

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
            const roomName = room.name.length > 12 ? `${room.name.slice(0, 11)}…` : room.name;

            return (
              <g key={id}>
                <rect
                  x={pos.x - 50}
                  y={pos.y - 20}
                  width={100}
                  height={40}
                  rx={4}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isCurrent ? 2 : 1}
                />
                <text
                  x={pos.x - 42}
                  y={pos.y - 4}
                  fill={textColor}
                  fontSize="10"
                  fontFamily="monospace"
                  opacity={isAdjacentUnvisited ? 0.8 : 1}
                >
                  {isAdjacentUnvisited ? roomName : `${getIcon(room.archetype)} ${roomName}`}
                </text>
                {isCurrent && (
                  <text
                    x={pos.x - 42}
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
