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
  const visitedSet = useMemo(() => new Set(visitedRoomIds), [visitedRoomIds]);

  const { positions, bounds } = layout;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Build connection lines (deduplicated)
  const connections: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const [id, room] of Object.entries(rooms)) {
    for (const conn of room.connections) {
      const key = [id, conn].sort().join('-');
      if (!seen.has(key)) {
        seen.add(key);
        connections.push({ from: id, to: conn });
      }
    }
  }

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
            return (
              <line
                key={`${from}-${to}`}
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke={COLORS.border}
                strokeWidth="1.5"
                strokeDasharray={visitedSet.has(from) && visitedSet.has(to) ? undefined : '4 4'}
              />
            );
          })}

          {/* Room nodes */}
          {Object.entries(rooms).map(([id, room]) => {
            const pos = positions.get(id);
            if (!pos) return null;

            const isCurrent = id === currentRoomId;
            const isVisited = visitedSet.has(id);
            const fill = isCurrent ? COLORS.title : (isVisited ? '#1e3a5f' : '#111820');
            const stroke = isCurrent ? COLORS.title : (isVisited ? COLORS.border : '#1a2030');
            const textColor = isCurrent ? '#000' : (isVisited ? COLORS.text : COLORS.textDim);

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
                >
                  {getIcon(room.archetype)} {room.name.length > 12 ? room.name.slice(0, 11) + '…' : room.name}
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

        <div className="mt-3 flex gap-4 text-xs text-omega-dim">
          <span><span style={{ color: COLORS.title }}>■</span> Current</span>
          <span><span style={{ color: COLORS.border }}>■</span> Visited</span>
          <span><span style={{ color: '#1a2030' }}>■</span> Unexplored</span>
        </div>
      </div>
    </div>
  );
}
