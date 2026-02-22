import { describe, expect, it } from 'vitest';
import { createTestState, createTestStation } from '../../test/fixtures/factories.js';
import {
  deserializeGameState,
  deserializeStation,
  serializeGameState,
  serializeStation,
  type SerializedStation,
} from './serialization.js';

describe('serialization helpers', () => {
  it('[Z] round-trips empty collection fields without loss', () => {
    const station = createTestStation();
    station.items.clear();
    station.npcs.clear();
    station.rooms.clear();
    station.mapLayout.positions.clear();

    const serialized = serializeStation(station);
    const restored = deserializeStation(serialized);

    expect(restored.rooms.size).toBe(0);
    expect(restored.items.size).toBe(0);
    expect(restored.npcs.size).toBe(0);
    expect(restored.mapLayout.positions.size).toBe(0);
  });

  it('[O] preserves minimal game state fields in a single roundtrip', () => {
    const state = createTestState();
    const serialized = serializeGameState(state);
    const restored = deserializeGameState(serialized);

    expect(restored.currentRoom).toBe(state.currentRoom);
    expect(restored.hp).toBe(state.hp);
    expect(restored.roomsVisited.has(state.currentRoom)).toBe(true);
  });

  it('[M] preserves full station object shape through serialize/deserialize', () => {
    const station = createTestStation();
    const serialized = serializeStation(station);
    const restored = deserializeStation(serialized);

    expect(restored.stationName).toBe(station.stationName);
    expect(restored.rooms.get('room_0')?.name).toBe('Docking Vestibule');
    expect(restored.items.get('item_wire')?.name).toBe('Insulated Wire');
    expect(restored.npcs.get('npc_0')?.behaviors.has('can_negotiate')).toBe(true);
  });

  it('[B] supports large room visit maps and metric sets', () => {
    const state = createTestState();
    for (let i = 0; i < 75; i++) {
      const roomId = `room_${String(i + 10)}`;
      state.roomVisitCount.set(roomId, i + 1);
      state.roomsVisited.add(roomId);
      state.metrics.roomsVisited.add(roomId);
    }

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.roomVisitCount.size).toBe(76);
    expect(restored.metrics.roomsVisited.size).toBe(76);
  });

  it('[I] emits records/arrays in serialized output contracts', () => {
    const station = createTestStation();
    const serialized = serializeStation(station);

    expect(Array.isArray(Object.keys(serialized.rooms))).toBe(true);
    expect(Array.isArray(serialized.npcs['npc_0'].behaviors)).toBe(true);
    expect(Array.isArray(serialized.crewRoster)).toBe(true);
  });

  it('[E] throws when serialized NPC behaviors are missing', () => {
    const station = createTestStation();
    const malformed = serializeStation(station) as SerializedStation & {
      npcs: Record<string, { behaviors: unknown }>;
    };
    malformed.npcs['npc_0'] = { ...malformed.npcs['npc_0'], behaviors: undefined };

    expect(() => deserializeStation(malformed as unknown as SerializedStation)).toThrow(
      'Invalid NPC behaviors for npc_0',
    );
  });

  it('[S] is idempotent across serialize -> deserialize -> serialize', () => {
    const station = createTestStation();
    const once = serializeStation(station);
    const twice = serializeStation(deserializeStation(once));
    expect(twice).toEqual(once);
  });
});
