import { describe, expect, it } from 'vitest';
import { createTestState, createTestStation } from '../../test/fixtures/factories.js';
import {
  deserializeGameState,
  deserializeStation,
  serializeGameState,
  serializeStation,
} from './serialization.js';

describe('serialization helpers', () => {
  it('[Z] round-trips empty collection fields without loss', () => {
    const station = createTestStation();
    station.items.clear();
    station.rooms.clear();
    station.mapLayout.positions.clear();

    const serialized = serializeStation(station);
    const restored = deserializeStation(serialized);

    expect(restored.rooms.size).toBe(0);
    expect(restored.items.size).toBe(0);
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
    expect(restored.objectives.title).toBe(station.objectives.title);
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
    expect(Array.isArray(serialized.crewRoster)).toBe(true);
  });

  it('[E] tolerates malformed extra NPC payloads left over from legacy fixtures', () => {
    const station = createTestStation();
    const malformed = {
      ...serializeStation(station),
      npcs: {
        npc_0: {
          behaviors: undefined,
        },
      },
    } as ReturnType<typeof serializeStation> & { npcs: Record<string, unknown> };

    const restored = deserializeStation(malformed);
    expect(restored.rooms.size).toBe(station.rooms.size);
  });

  it('[S] is idempotent across serialize -> deserialize -> serialize', () => {
    const station = createTestStation();
    const once = serializeStation(station);
    const twice = serializeStation(deserializeStation(once));
    expect(twice).toEqual(once);
  });

  it('[M] normalizes legacy objective reveal state across many deserialized mission steps', () => {
    const station = createTestStation();
    station.objectives.steps.push({
      id: 'step_2',
      description: 'Signal extraction.',
      roomId: 'room_1',
      requiredItemId: null,
      requiredSystemRepair: null,
      revealed: false,
      completed: false,
    });
    station.objectives.steps[0].completed = true;
    station.objectives.currentStepIndex = 99;

    const serialized = serializeStation(station);
    const legacySteps = serialized.objectives.steps as unknown as Array<
      Omit<typeof serialized.objectives.steps[number], 'revealed'> & { revealed?: boolean }
    >;
    for (const step of legacySteps) {
      Reflect.deleteProperty(step, 'revealed');
    }

    const restored = deserializeStation(serialized);

    expect(restored.objectives.currentStepIndex).toBe(1);
    expect(restored.objectives.steps[0].revealed).toBe(true);
    expect(restored.objectives.steps[1].revealed).toBe(true);
    expect(restored.objectives.steps[2].revealed).toBe(false);
  });

  it('[O] single populated eventCooldowns round-trips correctly', () => {
    const state = createTestState();
    state.eventCooldowns = { power_failure: 3, radiation_spike: 7 };
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.eventCooldowns).toEqual({ power_failure: 3, radiation_spike: 7 });
  });

  it('[I] eventCooldowns is present as a Record in serialized output contract', () => {
    const state = createTestState();
    state.eventCooldowns = { power_failure: 5 };
    const serialized = serializeGameState(state);
    expect(typeof serialized.eventCooldowns).toBe('object');
    expect(serialized.eventCooldowns).not.toBeNull();
    expect(serialized.eventCooldowns?.['power_failure']).toBe(5);
  });

  it('[E] missing eventCooldowns in serialized data defaults to empty object on deserialize', () => {
    const state = createTestState();
    const serialized = serializeGameState(state);
    const withoutCooldowns = { ...serialized, eventCooldowns: undefined };
    const restored = deserializeGameState(withoutCooldowns as typeof serialized);
    expect(restored.eventCooldowns).toEqual({});
  });
});
