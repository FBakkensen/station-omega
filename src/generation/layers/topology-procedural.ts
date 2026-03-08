/**
 * Layer 1: Procedural Topology Generation
 *
 * Replaces the AI-driven Layer 1 with deterministic procedural generation.
 * Pure constraint satisfaction — no AI call needed. Generates room graphs
 * with varied topology styles, archetype assignments, and locked doors.
 */

import type { RoomArchetype, Difficulty, CharacterClassId } from '../../types.js';
import type { ValidatedTopology } from './topology.js';
import { ROOM_COUNTS } from './topology.js';
import { SCENARIO_POOL } from '../../data.js';
import { checkBidirectional, checkConnectivity } from '../validate.js';
import { shuffle, pickRandom, randInt } from '../random-utils.js';

const ASSIGNABLE_ARCHETYPES: RoomArchetype[] = [
  'quarters', 'utility', 'science', 'command', 'medical', 'cargo', 'restricted', 'reactor',
];

// ─── Graph Builders ──────────────────────────────────────────────────────────

interface RoomNode {
  id: string;
  connections: Set<string>;
}

function addEdge(rooms: Map<string, RoomNode>, a: string, b: string): void {
  rooms.get(a)?.connections.add(b);
  rooms.get(b)?.connections.add(a);
}

function createNodes(count: number): Map<string, RoomNode> {
  const nodes = new Map<string, RoomNode>();
  for (let i = 0; i < count; i++) {
    nodes.set(`room_${String(i)}`, { id: `room_${String(i)}`, connections: new Set() });
  }
  return nodes;
}

function buildSmallWorld(count: number): Map<string, RoomNode> {
  const nodes = createNodes(count);
  const ids = [...nodes.keys()];

  // Step 1: Ring backbone (guarantees connectivity and long paths from entry)
  for (let i = 0; i < count; i++) {
    addEdge(nodes, ids[i], ids[(i + 1) % count]);
  }

  // Step 2: Add random shortcut edges among non-entry nodes.
  // Avoiding the entry node (ids[0]) preserves long BFS paths from start.
  const extraEdges = Math.max(2, Math.ceil(count * 0.4));
  let added = 0;
  for (let attempt = 0; attempt < extraEdges * 4 && added < extraEdges; attempt++) {
    const a = 1 + Math.floor(Math.random() * (count - 1));
    const b = 1 + Math.floor(Math.random() * (count - 1));
    const nodeA = nodes.get(ids[a]);
    if (a !== b && nodeA && !nodeA.connections.has(ids[b])) {
      addEdge(nodes, ids[a], ids[b]);
      added++;
    }
  }

  return nodes;
}

function ensureConnectivity(nodes: Map<string, RoomNode>): void {
  const ids = [...nodes.keys()];
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of ids) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      component.push(cur);
      const curNode = nodes.get(cur);
      if (!curNode) continue;
      for (const neighbor of curNode.connections) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    components.push(component);
  }

  // Bridge disconnected components to the first component
  for (let i = 1; i < components.length; i++) {
    addEdge(nodes, pickRandom(components[0]), pickRandom(components[i]));
  }
}

function selectEscapeRoom(nodes: Map<string, RoomNode>, entryId: string): string {
  const depths = bfsDepths(entryId, nodes);
  let maxDist = 0;
  let farthest = entryId;
  for (const [id, dist] of depths) {
    if (dist > maxDist) { maxDist = dist; farthest = id; }
  }
  return farthest;
}

// ─── Archetype Assignment ────────────────────────────────────────────────────

function assignArchetypes(
  roomCount: number,
  entryIdx: number,
  escapeIdx: number,
): RoomArchetype[] {
  const archetypes: RoomArchetype[] = new Array<RoomArchetype>(roomCount);
  archetypes[entryIdx] = 'entry';
  archetypes[escapeIdx] = 'escape';

  // Build a pool with max-3 variety constraint
  // We need (roomCount - 2) archetypes for non-entry/escape rooms
  const needed = roomCount - 2;
  const pool: RoomArchetype[] = [];

  // Add up to 3 of each archetype
  for (const arch of ASSIGNABLE_ARCHETYPES) {
    for (let i = 0; i < 3; i++) {
      pool.push(arch);
    }
  }

  shuffle(pool);
  const selected = pool.slice(0, needed);

  // If we need more than pool size (shouldn't happen with 8 archetypes * 3 = 24),
  // fill remaining with random picks (respecting max-3)
  while (selected.length < needed) {
    const counts = new Map<RoomArchetype, number>();
    for (const a of selected) counts.set(a, (counts.get(a) ?? 0) + 1);
    // Also count entry/escape
    counts.set('entry', (counts.get('entry') ?? 0) + 1);
    counts.set('escape', (counts.get('escape') ?? 0) + 1);

    const available = ASSIGNABLE_ARCHETYPES.filter(a => (counts.get(a) ?? 0) < 3);
    if (available.length === 0) break;
    selected.push(pickRandom(available));
  }

  let selIdx = 0;
  for (let i = 0; i < roomCount; i++) {
    if (i === entryIdx || i === escapeIdx) continue;
    archetypes[i] = selected[selIdx++];
  }

  return archetypes;
}

// ─── BFS Helpers ─────────────────────────────────────────────────────────────

function bfsDistance(
  fromId: string,
  toId: string,
  rooms: Map<string, RoomNode>,
): number {
  const dist = new Map<string, number>();
  const queue: string[] = [fromId];
  dist.set(fromId, 0);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    if (cur === toId) return dist.get(cur) ?? 0;
    const node = rooms.get(cur);
    if (!node) continue;
    for (const neighbor of node.connections) {
      if (!dist.has(neighbor)) {
        dist.set(neighbor, (dist.get(cur) ?? 0) + 1);
        queue.push(neighbor);
      }
    }
  }

  return dist.get(toId) ?? -1;
}

function bfsDepths(fromId: string, rooms: Map<string, RoomNode>): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [fromId];
  dist.set(fromId, 0);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const node = rooms.get(cur);
    if (!node) continue;
    for (const neighbor of node.connections) {
      if (!dist.has(neighbor)) {
        dist.set(neighbor, (dist.get(cur) ?? 0) + 1);
        queue.push(neighbor);
      }
    }
  }

  return dist;
}

// ─── Locked Door Placement ───────────────────────────────────────────────────

interface LockedDoorResult {
  lockedRoomIds: Set<string>;
  keycardIds: Map<string, string>; // roomId -> keycardId
}

function placeLocks(
  rooms: Map<string, RoomNode>,
  entryId: string,
  escapeId: string,
): LockedDoorResult {
  const depths = bfsDepths(entryId, rooms);
  const result: LockedDoorResult = { lockedRoomIds: new Set(), keycardIds: new Map() };

  // Find candidates at BFS depth >= 3 from entry that aren't entry/escape
  const candidates = [...rooms.keys()].filter(id =>
    id !== entryId &&
    id !== escapeId &&
    (depths.get(id) ?? 0) >= 3,
  );

  if (candidates.length === 0) return result;

  shuffle(candidates);

  // Place 1-2 locked doors
  const lockCount = Math.min(randInt(1, 2), candidates.length);
  let keycardCounter = 0;

  for (let i = 0; i < lockCount; i++) {
    const roomId = candidates[i];
    const keycardId = `keycard_${String(keycardCounter++)}`;
    result.lockedRoomIds.add(roomId);
    result.keycardIds.set(roomId, keycardId);
  }

  // Validate: escape must require passing through at least one locked door
  // BFS from entry, excluding edges into locked rooms
  const visited = new Set<string>([entryId]);
  const queue: string[] = [entryId];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const node = rooms.get(cur);
    if (!node) continue;
    for (const neighbor of node.connections) {
      if (!visited.has(neighbor) && !result.lockedRoomIds.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // If escape is reachable without any locked door, try to fix by locking a room on
  // the shortest path to escape
  if (visited.has(escapeId) && result.lockedRoomIds.size > 0) {
    // Find a room on the path to escape that we can lock
    // BFS shortest path from entry to escape
    const parent = new Map<string, string>();
    const bfsQueue = [entryId];
    const bfsVisited = new Set<string>([entryId]);

    while (bfsQueue.length > 0) {
      const cur = bfsQueue.shift();
      if (cur === undefined) break;
      if (cur === escapeId) break;
      const node = rooms.get(cur);
      if (!node) continue;
      for (const neighbor of node.connections) {
        if (!bfsVisited.has(neighbor)) {
          bfsVisited.add(neighbor);
          parent.set(neighbor, cur);
          bfsQueue.push(neighbor);
        }
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let cur: string | undefined = escapeId;
    while (cur !== undefined && cur !== entryId) {
      path.unshift(cur);
      cur = parent.get(cur);
    }

    // Move the first lock to a room on this path (not entry/escape)
    const pathCandidates = path.filter(id => id !== entryId && id !== escapeId);
    if (pathCandidates.length > 0) {
      // Remove the first lock placement and replace with a path room
      const firstLocked = [...result.lockedRoomIds][0];
      const keycardId = result.keycardIds.get(firstLocked) ?? 'keycard_0';
      result.lockedRoomIds.delete(firstLocked);
      result.keycardIds.delete(firstLocked);

      const newLockRoom = pickRandom(pathCandidates);
      result.lockedRoomIds.add(newLockRoom);
      result.keycardIds.set(newLockRoom, keycardId);
    }
  }

  return result;
}

// ─── Main Generator ──────────────────────────────────────────────────────────

export function generateTopologyProcedural(
  difficulty: Difficulty,
  _characterClass: CharacterClassId,
  log?: (label: string, content: string) => void,
): ValidatedTopology {
  const [minRooms, maxRooms] = ROOM_COUNTS[difficulty];
  const roomCount = randInt(minRooms, maxRooms);

  log?.('PROCEDURAL-L1', `Generating small_world topology with ${String(roomCount)} rooms for ${difficulty} difficulty`);

  // Phase 1: Build graph using small-world algorithm (ring + random shortcuts)
  let graphNodes = buildSmallWorld(roomCount);
  ensureConnectivity(graphNodes);
  let ids = [...graphNodes.keys()];
  let entryId = ids[0];
  let escapeId = selectEscapeRoom(graphNodes, entryId);
  let escapeIdx = ids.indexOf(escapeId);

  // Phase 2: Remove direct entry-escape edge for distance
  graphNodes.get(entryId)?.connections.delete(escapeId);
  graphNodes.get(escapeId)?.connections.delete(entryId);
  if (bfsDistance(entryId, escapeId, graphNodes) < 0) {
    addEdge(graphNodes, entryId, escapeId);
  }

  // Retry if entry-to-escape distance < 3 (rare with ring backbone)
  for (let attempt = 1; attempt < 5 && bfsDistance(entryId, escapeId, graphNodes) < 3; attempt++) {
    graphNodes = buildSmallWorld(roomCount);
    ensureConnectivity(graphNodes);
    ids = [...graphNodes.keys()];
    entryId = ids[0];
    escapeId = selectEscapeRoom(graphNodes, entryId);
    escapeIdx = ids.indexOf(escapeId);
    graphNodes.get(entryId)?.connections.delete(escapeId);
    graphNodes.get(escapeId)?.connections.delete(entryId);
    if (bfsDistance(entryId, escapeId, graphNodes) < 0) {
      addEdge(graphNodes, entryId, escapeId);
    }
  }

  // Phase 3: Assign archetypes
  const archetypes = assignArchetypes(roomCount, 0, escapeIdx);

  // Phase 4: Place locked doors
  const locks = placeLocks(graphNodes, entryId, escapeId);

  // Phase 5: Pick scenario
  const scenario = pickRandom(SCENARIO_POOL);

  // Phase 6: Assemble result
  const rooms: ValidatedTopology['rooms'] = ids.map((id, i) => ({
    id,
    archetype: archetypes[i],
    connections: [...(graphNodes.get(id)?.connections ?? [])],
    lockedBy: locks.keycardIds.get(id) ?? null,
  }));

  // Phase 7: Sanity checks
  const bidiErrors = checkBidirectional(rooms);
  if (bidiErrors.length > 0) {
    log?.('PROCEDURAL-L1-WARN', `Bidirectional errors (should not happen): ${bidiErrors.join('; ')}`);
  }

  const unreachable = checkConnectivity(rooms, entryId);
  if (unreachable.length > 0) {
    log?.('PROCEDURAL-L1-WARN', `Unreachable rooms (should not happen): ${unreachable.join(', ')}`);
    // Fix by connecting unreachable rooms to the entry
    for (const unreachableId of unreachable) {
      const room = rooms.find(r => r.id === unreachableId);
      const entryRoom = rooms.find(r => r.id === entryId);
      if (room && entryRoom) {
        room.connections.push(entryId);
        entryRoom.connections.push(unreachableId);
      }
    }
  }

  const locked = rooms.filter(r => r.lockedBy).map(r => `${r.id} [${String(r.lockedBy)}]`);
  log?.('PROCEDURAL-L1', [
    `Topology: small_world, Rooms: ${String(rooms.length)}`,
    `Entry: ${entryId}, Escape: ${escapeId}`,
    `Locked doors: ${locked.length > 0 ? locked.join(', ') : 'none'}`,
    `Scenario: ${scenario.theme}`,
  ].join('\n'));

  return {
    topology: 'small_world',
    scenario: { theme: scenario.theme, centralTension: scenario.centralTension },
    rooms,
    entryRoomId: entryId,
    escapeRoomId: escapeId,
  };
}
