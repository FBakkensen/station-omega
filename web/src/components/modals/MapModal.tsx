import { useMemo, useState } from 'react';
import type { StationImage } from '../../hooks/useStationImages';
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
  stationImages: Map<string, StationImage>;
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

/** Approximate width of a single character in monospace at fontSize 10. */
const CHAR_WIDTH = 6.1;
/** Horizontal padding inside each room box (total, split evenly left/right). */
const ROOM_H_PAD = 16;
/** Minimum gap between room columns. */
const COLUMN_GAP = 60;
/** Vertical gap between room boxes in the same depth column. */
const ROW_GAP = 40;
/** Size of corner bracket decorations on room boxes. */
const BRACKET_SIZE = 8;
/** Minimum viewBox dimensions to prevent over-scaling with few rooms. */
const MIN_VIEWBOX_W = 900;
const MIN_VIEWBOX_H = 600;

/** Compute the display text length (in characters) for a room. */
function displayTextLen(room: MapRoom): number {
  // Icon + space + full name (worst case: visited/current shows icon)
  return 2 + room.name.length;
}

/**
 * Generate a force-directed-inspired layout for SVG rendering.
 * Groups rooms by depth on the X axis, spreads vertically within each group.
 * Room width is derived from the longest display text so nothing is truncated.
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

  // Derive room box width from the longest display text, then height from 16:9 ratio
  let maxChars = 14; // minimum sensible width
  for (const id of roomIds) {
    maxChars = Math.max(maxChars, displayTextLen(rooms[id]));
  }
  const roomWidth = Math.ceil(maxChars * CHAR_WIDTH + ROOM_H_PAD);
  const roomHeight = Math.round(roomWidth * (9 / 16));
  const DX = roomWidth + COLUMN_GAP;
  const rowSpacing = roomHeight + ROW_GAP;

  const positions = new Map<string, { x: number; y: number }>();
  const maxDepth = Math.max(...[...byDepth.keys()]);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const ids = byDepth.get(depth) ?? [];
    const x = depth * DX + roomWidth / 2 + 20;
    const groupHeight = (ids.length - 1) * rowSpacing;
    const startY = -groupHeight / 2 + 250; // Center vertically around 250

    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x, y: startY + i * rowSpacing });
    }
  }

  return { positions, roomWidth, roomHeight };
}

/** Compute a quadratic Bézier control point offset perpendicular to the midpoint. */
function bezierControlPoint(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  offset: number,
): { x: number; y: number } {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular unit vector
  return { x: mx + (-dy / len) * offset, y: my + (dx / len) * offset };
}

/** SVG defs block with grid pattern, glow filter, image filters, and cross-hatch pattern. */
function SvgDefs({ roomWidth: rw, roomHeight: rh }: { roomWidth: number; roomHeight: number }) {
  return (
    <defs>
      {/* Subtle grid background */}
      <pattern id="map-grid" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke={COLORS.title} strokeWidth="0.3" opacity="0.12" />
      </pattern>

      {/* Glow filter for current room */}
      <filter id="room-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feFlood floodColor={COLORS.title} floodOpacity="0.6" result="color" />
        <feComposite in="color" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Dim + desaturate filter for visited room images */}
      <filter id="img-dim" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0.45" />
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.5" />
          <feFuncG type="linear" slope="0.5" />
          <feFuncB type="linear" slope="0.5" />
        </feComponentTransfer>
      </filter>

      {/* Brighter filter for current room image */}
      <filter id="img-current" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0.65" />
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.7" />
          <feFuncG type="linear" slope="0.7" />
          <feFuncB type="linear" slope="0.7" />
        </feComponentTransfer>
      </filter>

      {/* Heavy blur + dim for unvisited rooms using briefing image */}
      <filter id="img-blur-dim" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="6" />
        <feColorMatrix type="saturate" values="0.2" />
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.35" />
          <feFuncG type="linear" slope="0.35" />
          <feFuncB type="linear" slope="0.35" />
        </feComponentTransfer>
      </filter>

      {/* Bottom gradient overlay for text readability */}
      <linearGradient id="room-text-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#000" stopOpacity="0" />
        <stop offset="60%" stopColor="#000" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
      </linearGradient>

      {/* Inner vignette for room image depth */}
      <radialGradient id="room-vignette" cx="50%" cy="50%" r="65%" fx="50%" fy="50%">
        <stop offset="0%" stopColor="transparent" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.35" />
      </radialGradient>

      {/* Cross-hatch pattern for unvisited rooms */}
      <pattern id="crosshatch" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#2b3447" strokeWidth="1" opacity="0.5" />
      </pattern>

      {/* Scan sweep gradient */}
      <linearGradient id="scan-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={COLORS.title} stopOpacity="0" />
        <stop offset="40%" stopColor={COLORS.title} stopOpacity="0.08" />
        <stop offset="50%" stopColor={COLORS.title} stopOpacity="0.15" />
        <stop offset="60%" stopColor={COLORS.title} stopOpacity="0.08" />
        <stop offset="100%" stopColor={COLORS.title} stopOpacity="0" />
      </linearGradient>

      {/* Clip path template — actual clip paths are per-room in renderRoomNode */}
      {/* Using clipPathUnits="objectBoundingBox" won't work with rx, so we define per-room below */}

      {/* Scanline overlay pattern for rooms */}
      <pattern id="room-scanlines" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="4" y2="0" stroke="#000" strokeWidth="0.5" opacity="0.15" />
      </pattern>

      {/* Static noise pattern for unvisited rooms without briefing image */}
      <filter id="noise-filter">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="noise" />
        <feColorMatrix type="saturate" values="0" in="noise" result="gray-noise" />
        <feComponentTransfer in="gray-noise">
          <feFuncR type="linear" slope="0.08" intercept="0.04" />
          <feFuncG type="linear" slope="0.08" intercept="0.06" />
          <feFuncB type="linear" slope="0.12" intercept="0.08" />
          <feFuncA type="linear" slope="1" />
        </feComponentTransfer>
      </filter>

      {/* Per-room clip paths will be added by RoomNode */}
      {/* We need a generic one for the template size */}
      <clipPath id="room-clip-template">
        <rect x="0" y="0" width={rw} height={rh} rx={3} />
      </clipPath>
    </defs>
  );
}

/** Corner bracket decorations for a room box (technical frame marks). */
function CornerBrackets({
  x, y, w, h, stroke, opacity = 0.5,
}: { x: number; y: number; w: number; h: number; stroke: string; opacity?: number }) {
  const s = BRACKET_SIZE;
  return (
    <g stroke={stroke} strokeWidth="1" opacity={opacity} fill="none">
      {/* Top-left */}
      <polyline points={`${String(x + s)},${String(y)} ${String(x)},${String(y)} ${String(x)},${String(y + s)}`} />
      {/* Top-right */}
      <polyline points={`${String(x + w - s)},${String(y)} ${String(x + w)},${String(y)} ${String(x + w)},${String(y + s)}`} />
      {/* Bottom-left */}
      <polyline points={`${String(x + s)},${String(y + h)} ${String(x)},${String(y + h)} ${String(x)},${String(y + h - s)}`} />
      {/* Bottom-right */}
      <polyline points={`${String(x + w - s)},${String(y + h)} ${String(x + w)},${String(y + h)} ${String(x + w)},${String(y + h - s)}`} />
    </g>
  );
}

export function MapModal({ rooms, currentRoomId, visitedRoomIds, stationImages, onClose }: MapModalProps) {
  const seed = useMemo(() => hashSeed(rooms), [rooms]);
  const layout = useMemo(() => computeLayout(rooms, seed), [rooms, seed]);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  const {
    visibleRoomIds,
    roomVisibility,
    connections,
    visibleArchetypes,
    hasCurrent,
    hasVisited,
    hasAdjacentUnvisited,
    exploredCount,
    adjacentCount,
    totalRooms,
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
      exploredCount: visitedSet.size,
      adjacentCount: adjacentUnvisited.size,
      totalRooms: Object.keys(rooms).length,
    };
  }, [rooms, currentRoomId, visitedRoomIds]);

  // Rooms connected to hovered room (for highlight effect)
  const hoveredConnections = useMemo(() => {
    if (!hoveredRoom) return new Set<string>();
    const room = rooms[hoveredRoom];
    const connected = new Set(room.connections);
    connected.add(hoveredRoom);
    return connected;
  }, [hoveredRoom, rooms]);

  // Sorted room list for left sidebar
  const sortedRoomList = useMemo(() => {
    return visibleRoomIds
      .map((id) => ({ id, room: rooms[id], visibility: roomVisibility.get(id) ?? 'adjacent-unvisited' as RoomVisibility }))
      .sort((a, b) => {
        // Current first, then visited, then adjacent
        const order: Record<RoomVisibility, number> = { current: 0, visited: 1, 'adjacent-unvisited': 2 };
        const diff = order[a.visibility] - order[b.visibility];
        if (diff !== 0) return diff;
        return a.room.depth - b.room.depth || a.room.name.localeCompare(b.room.name);
      });
  }, [visibleRoomIds, rooms, roomVisibility]);

  const { positions, roomWidth, roomHeight } = layout;
  const halfW = roomWidth / 2;
  const bounds = useMemo(() => {
    const PADDING_X = 40;
    const PADDING_Y = 60;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const roomId of visibleRoomIds) {
      const pos = positions.get(roomId);
      if (!pos) continue;
      minX = Math.min(minX, pos.x - halfW);
      maxX = Math.max(maxX, pos.x + halfW);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return { minX: 0, maxX: MIN_VIEWBOX_W, minY: 0, maxY: MIN_VIEWBOX_H };
    }

    let bMinX = minX - PADDING_X;
    let bMaxX = maxX + PADDING_X;
    let bMinY = minY - PADDING_Y;
    let bMaxY = maxY + PADDING_Y;

    // Enforce minimum viewBox size so rooms don't over-scale with few rooms
    const contentW = bMaxX - bMinX;
    const contentH = bMaxY - bMinY;
    if (contentW < MIN_VIEWBOX_W) {
      const cx = (bMinX + bMaxX) / 2;
      bMinX = cx - MIN_VIEWBOX_W / 2;
      bMaxX = cx + MIN_VIEWBOX_W / 2;
    }
    if (contentH < MIN_VIEWBOX_H) {
      const cy = (bMinY + bMaxY) / 2;
      bMinY = cy - MIN_VIEWBOX_H / 2;
      bMaxY = cy + MIN_VIEWBOX_H / 2;
    }

    return { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
  }, [positions, visibleRoomIds, halfW]);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-omega-border bg-omega-panel w-[90vw] max-w-screen-2xl h-[75vh] overflow-hidden flex flex-col"
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* ── Tactical Header ─────────────────────────────────── */}
        <div className="flex justify-between items-center px-4 py-2 border-b border-omega-border bg-omega-bg/50">
          <h2 className="text-omega-title text-xs uppercase tracking-widest font-bold">
            ▸ Deck Scanner — Active
          </h2>
          <span className="text-omega-dim text-xs uppercase tracking-wider">
            Sectors Mapped: {exploredCount}/{totalRooms}
          </span>
          <button
            onClick={onClose}
            className="text-omega-dim hover:text-omega-text text-xs uppercase tracking-wider"
          >
            [ESC] Close
          </button>
        </div>

        {/* ── Three-Panel Body ────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Left Sidebar: Scan Log ──────────────────────── */}
          <div className="hidden md:flex flex-col w-40 border-r border-omega-border bg-omega-bg/30 overflow-y-auto">
            <div className="px-3 py-2 border-b border-omega-border">
              <span className="text-omega-title text-[11px] uppercase tracking-widest">Scan Log</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sortedRoomList.map(({ id, room, visibility: vis }) => {
                const isCurrent = vis === 'current';
                const isAdj = vis === 'adjacent-unvisited';
                return (
                  <div
                    key={id}
                    className={`px-3 py-1.5 text-[11px] font-mono border-b border-omega-border/30 cursor-default
                      ${isCurrent ? 'bg-omega-title/10 text-omega-title' : ''}
                      ${vis === 'visited' ? 'text-omega-text' : ''}
                      ${isAdj ? 'text-omega-dim opacity-60' : ''}
                    `}
                    onMouseEnter={() => { setHoveredRoom(id); }}
                    onMouseLeave={() => { setHoveredRoom(null); }}
                  >
                    <span className="mr-1">{isAdj ? '?' : getIcon(room.archetype)}</span>
                    {isCurrent ? '► ' : ''}{room.name}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Center: SVG Map ─────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-auto p-2 flex items-center justify-center">
            {visibleRoomIds.length === 0 ? (
              <p className="text-xs text-omega-dim p-4">No map data is available for this run yet.</p>
            ) : (
              <svg
                viewBox={`${String(bounds.minX)} ${String(bounds.minY)} ${String(width)} ${String(height)}`}
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-full"
                style={{ '--map-width': `${String(Math.min(width, 800))}px` } as React.CSSProperties}
              >
                <SvgDefs roomWidth={roomWidth} roomHeight={roomHeight} />

                {/* Grid background */}
                <rect
                  x={bounds.minX} y={bounds.minY}
                  width={width} height={height}
                  fill="url(#map-grid)"
                />

                {/* Scan sweep overlay */}
                <rect
                  x={bounds.minX} y={bounds.minY}
                  width={width * 0.15} height={height}
                  fill="url(#scan-gradient)"
                  className="map-scan-sweep"
                  style={{ transformOrigin: `${String(bounds.minX)}px ${String(bounds.minY)}px` }}
                />

                {/* Connection paths (Bézier curves) */}
                {connections.map(({ from, to }) => {
                  const p1 = positions.get(from);
                  const p2 = positions.get(to);
                  if (!p1 || !p2) return null;
                  const fromVis = roomVisibility.get(from);
                  const toVis = roomVisibility.get(to);
                  const isStrong =
                    (fromVis === 'current' || fromVis === 'visited') &&
                    (toVis === 'current' || toVis === 'visited');
                  const isHovered = hoveredRoom !== null &&
                    (hoveredConnections.has(from) && hoveredConnections.has(to));

                  // Compute Bézier control point with perpendicular offset
                  const cp = bezierControlPoint(p1, p2, 20);
                  const mx = (p1.x + p2.x) / 2;
                  const my = (p1.y + p2.y) / 2;

                  return (
                    <g key={`${from}-${to}`}>
                      {/* Glow backdrop for hovered connections */}
                      {isHovered && (
                        <path
                          d={`M ${String(p1.x)} ${String(p1.y)} Q ${String(cp.x)} ${String(cp.y)} ${String(p2.x)} ${String(p2.y)}`}
                          fill="none"
                          stroke={COLORS.title}
                          strokeWidth="6"
                          opacity="0.15"
                        />
                      )}
                      <path
                        d={`M ${String(p1.x)} ${String(p1.y)} Q ${String(cp.x)} ${String(cp.y)} ${String(p2.x)} ${String(p2.y)}`}
                        fill="none"
                        stroke={isHovered ? COLORS.title : (isStrong ? COLORS.border : '#33435f')}
                        strokeWidth={isStrong ? 2 : 1.5}
                        strokeDasharray={isStrong ? undefined : '5 5'}
                        opacity={isHovered ? 0.9 : (isStrong ? 0.85 : 0.55)}
                      />
                      {/* Door indicator at midpoint for explored connections */}
                      {isStrong && (
                        <circle
                          cx={mx} cy={my} r="3.5"
                          fill={COLORS.bg}
                          stroke={isHovered ? COLORS.title : COLORS.border}
                          strokeWidth="1.5"
                          opacity="0.7"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Room nodes */}
                {visibleRoomIds.map((id) => {
                  const room = rooms[id];
                  const pos = positions.get(id);
                  if (!pos) return null;

                  const vis = roomVisibility.get(id) ?? 'adjacent-unvisited';
                  const isCurrent = vis === 'current';
                  const isVisited = vis === 'visited';
                  const isAdj = vis === 'adjacent-unvisited';
                  const isHovered = hoveredConnections.has(id);

                  const rx = pos.x - halfW;
                  const ry = pos.y - roomHeight / 2;
                  const clipId = `room-clip-${id}`;

                  // Image lookup
                  const roomImage = stationImages.get(`room:${id}`);
                  const briefingImage = stationImages.get('briefing');
                  const hasRoomImage = (isCurrent || isVisited) && roomImage?.url;
                  const hasBriefingBg = isAdj && briefingImage?.url;

                  const stroke = isCurrent
                    ? COLORS.title
                    : (isVisited ? COLORS.border : '#2b3447');
                  const displayText = isAdj
                    ? `? ${room.name}`
                    : `${getIcon(room.archetype)} ${room.name}`;

                  return (
                    <g
                      key={id}
                      onMouseEnter={() => { setHoveredRoom(id); }}
                      onMouseLeave={() => { setHoveredRoom(null); }}
                      style={{ cursor: 'default' }}
                    >
                      {/* Per-room clip path */}
                      <defs>
                        <clipPath id={clipId}>
                          <rect x={rx} y={ry} width={roomWidth} height={roomHeight} rx={3} />
                        </clipPath>
                      </defs>

                      {/* Glow outline on current room */}
                      {isCurrent && (
                        <rect
                          x={rx - 4} y={ry - 4}
                          width={roomWidth + 8} height={roomHeight + 8}
                          rx={6}
                          fill="none"
                          stroke={COLORS.title}
                          strokeWidth="2"
                          opacity="0.4"
                          className="map-glow-pulse"
                        />
                      )}

                      {/* Room background rect (fallback / base color) */}
                      <rect
                        x={rx} y={ry}
                        width={roomWidth} height={roomHeight}
                        rx={3}
                        fill={isAdj ? '#0a0e18' : (isCurrent ? '#0d1a2a' : '#0f1825')}
                        stroke={isHovered ? COLORS.title : stroke}
                        strokeWidth={isCurrent ? 2 : 1}
                        strokeDasharray={isAdj ? '4 4' : undefined}
                        filter={isCurrent ? 'url(#room-glow)' : undefined}
                        opacity={isAdj ? 0.7 : 1}
                      />

                      {/* Room image background — visited/current rooms */}
                      {hasRoomImage && (
                        <image
                          href={roomImage.url}
                          x={rx} y={ry}
                          width={roomWidth} height={roomHeight}
                          preserveAspectRatio="xMidYMid slice"
                          clipPath={`url(#${clipId})`}
                          filter={isCurrent ? 'url(#img-current)' : 'url(#img-dim)'}
                        />
                      )}

                      {/* Briefing image background — adjacent-unvisited rooms */}
                      {hasBriefingBg && (
                        <image
                          href={briefingImage.url}
                          x={rx} y={ry}
                          width={roomWidth} height={roomHeight}
                          preserveAspectRatio="xMidYMid slice"
                          clipPath={`url(#${clipId})`}
                          filter="url(#img-blur-dim)"
                        />
                      )}

                      {/* Static noise fallback for unvisited without briefing */}
                      {isAdj && !hasBriefingBg && (
                        <rect
                          x={rx} y={ry}
                          width={roomWidth} height={roomHeight}
                          clipPath={`url(#${clipId})`}
                          filter="url(#noise-filter)"
                          opacity="0.6"
                        />
                      )}

                      {/* Cross-hatch overlay for adjacent-unvisited */}
                      {isAdj && (
                        <rect
                          x={rx} y={ry}
                          width={roomWidth} height={roomHeight}
                          rx={3}
                          fill="url(#crosshatch)"
                          opacity="0.25"
                        />
                      )}

                      {/* Inner vignette overlay */}
                      {(hasRoomImage || hasBriefingBg) && (
                        <rect
                          x={rx} y={ry}
                          width={roomWidth} height={roomHeight}
                          clipPath={`url(#${clipId})`}
                          fill="url(#room-vignette)"
                          opacity="0.6"
                        />
                      )}

                      {/* Scanline overlay */}
                      <rect
                        x={rx} y={ry}
                        width={roomWidth} height={roomHeight}
                        clipPath={`url(#${clipId})`}
                        fill="url(#room-scanlines)"
                        opacity={isAdj ? 0.3 : 0.5}
                      />

                      {/* Bottom gradient for text readability */}
                      <rect
                        x={rx} y={ry}
                        width={roomWidth} height={roomHeight}
                        clipPath={`url(#${clipId})`}
                        fill="url(#room-text-gradient)"
                      />

                      {/* Room border (on top of image) */}
                      <rect
                        x={rx} y={ry}
                        width={roomWidth} height={roomHeight}
                        rx={3}
                        fill="none"
                        stroke={isHovered ? COLORS.title : stroke}
                        strokeWidth={isCurrent ? 2 : 1}
                        strokeDasharray={isAdj ? '4 4' : undefined}
                      />

                      {/* Corner bracket decorations */}
                      <CornerBrackets
                        x={rx} y={ry} w={roomWidth} h={roomHeight}
                        stroke={isCurrent ? COLORS.title : (isHovered ? COLORS.title : stroke)}
                        opacity={isCurrent ? 0.9 : (isAdj ? 0.3 : 0.6)}
                      />

                      {/* Archetype icon — top left */}
                      {!isAdj && (
                        <text
                          x={rx + 6}
                          y={ry + 14}
                          fill={isCurrent ? COLORS.title : '#8a9aaf'}
                          fontSize="11"
                          fontFamily="monospace"
                          opacity="0.8"
                        >
                          {getIcon(room.archetype)}
                        </text>
                      )}

                      {/* Text shadow for readability */}
                      <text
                        x={rx + 6.5}
                        y={ry + roomHeight - 9.5}
                        fill="#000"
                        fontSize="10"
                        fontFamily="monospace"
                        opacity="0.5"
                        style={{ pointerEvents: 'none' }}
                      >
                        {displayText}
                      </text>

                      {/* Room name — bottom left, over gradient */}
                      <text
                        x={rx + 6}
                        y={ry + roomHeight - 10}
                        fill={isHovered && !isCurrent ? COLORS.title : (isCurrent ? '#fff' : (isAdj ? '#6a7a8f' : '#d0d8e8'))}
                        fontSize="10"
                        fontFamily="monospace"
                        opacity={isAdj ? 0.8 : 1}
                      >
                        {displayText}
                      </text>

                      {/* Current room indicator — top right */}
                      {isCurrent && (
                        <text
                          x={rx + roomWidth - 6}
                          y={ry + 14}
                          fill={COLORS.title}
                          fontSize="8"
                          fontFamily="monospace"
                          textAnchor="end"
                          opacity="0.9"
                        >
                          ► CURRENT
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* ── Right Sidebar: Systems ──────────────────────── */}
          <div className="hidden md:flex flex-col w-40 border-l border-omega-border bg-omega-bg/30">
            <div className="px-3 py-2 border-b border-omega-border">
              <span className="text-omega-title text-[11px] uppercase tracking-widest">Systems</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
              {/* State legend */}
              <div className="space-y-1">
                <div className="text-[10px] text-omega-dim uppercase tracking-wider mb-1">Status</div>
                {hasCurrent && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 map-glow-pulse" style={{ backgroundColor: COLORS.title }} />
                    <span className="text-omega-text">Current</span>
                  </div>
                )}
                {hasVisited && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2" style={{ backgroundColor: '#1a2f4a', border: `1px solid ${COLORS.border}` }} />
                    <span className="text-omega-text">Explored</span>
                  </div>
                )}
                {hasAdjacentUnvisited && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2" style={{ backgroundColor: '#0f1420', border: '1px dashed #2b3447' }} />
                    <span className="text-omega-dim">Detected</span>
                  </div>
                )}
              </div>

              {/* Room types */}
              {visibleArchetypes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-omega-dim uppercase tracking-wider mb-1">Room Types</div>
                  {visibleArchetypes.map((archetype) => (
                    <div key={archetype} className="flex items-center gap-1.5 text-[11px] text-omega-dim">
                      <span className="text-omega-text">{getIcon(archetype)}</span>
                      <span>{formatArchetype(archetype)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Status Footer ───────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-omega-border bg-omega-bg/50 text-[10px] text-omega-dim uppercase tracking-wider">
          <span>{exploredCount} sector{exploredCount !== 1 ? 's' : ''} explored</span>
          {adjacentCount > 0 && <span>{adjacentCount} adjacent detected</span>}
          <span className="hidden md:inline">Dimmed = unscanned one-hop exits</span>
        </div>
      </div>
    </div>
  );
}
