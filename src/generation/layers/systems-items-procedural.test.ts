import { describe, expect, it, vi } from 'vitest';
import { generateSystemsItemsProcedural } from './systems-items-procedural.js';
import type { ValidatedTopology } from './topology.js';
import { checkMaterialReachability } from '../validate.js';

function withRandomSequence<T>(values: number[], run: () => T): T {
  let idx = 0;
  const fallback = values.length > 0 ? values[values.length - 1] : 0.5;
  const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = idx < values.length ? values[idx] : undefined;
    idx += 1;
    return value === undefined ? fallback : value;
  });

  try {
    return run();
  } finally {
    randomSpy.mockRestore();
  }
}

function makeTopology(overrides: Partial<ValidatedTopology> = {}): ValidatedTopology {
  return {
    topology: 'branching_tree',
    scenario: {
      theme: 'Relay collapse',
      centralTension: 'Power is cascading through adjacent rooms.',
    },
    rooms: [
      {
        id: 'room_0',
        archetype: 'entry',
        connections: ['room_1'],
        lockedBy: null,
      },
      {
        id: 'room_1',
        archetype: 'utility',
        connections: ['room_0', 'room_2', 'room_3'],
        lockedBy: null,
      },
      {
        id: 'room_2',
        archetype: 'science',
        connections: ['room_1', 'room_4'],
        lockedBy: 'keycard_alpha',
      },
      {
        id: 'room_3',
        archetype: 'cargo',
        connections: ['room_1'],
        lockedBy: 'keycard_beta',
      },
      {
        id: 'room_4',
        archetype: 'escape',
        connections: ['room_2'],
        lockedBy: null,
      },
    ],
    entryRoomId: 'room_0',
    escapeRoomId: 'room_4',
    ...overrides,
  };
}

describe('generateSystemsItemsProcedural contracts', () => {
  it('[Z] emits zero keycard items when zero locked-door IDs are present in topology', () => {
    const topology = makeTopology({
      rooms: makeTopology().rooms.map((room) => ({ ...room, lockedBy: null })),
    });

    const generated = withRandomSequence([0.2], () => generateSystemsItemsProcedural(topology));
    const keycards = generated.items.filter((item) => item.isKeyItem);

    expect(keycards).toHaveLength(0);
  });

  it('[O] generates one minimal valid failure set with at least one reachable material item', () => {
    const topology = makeTopology();

    const generated = withRandomSequence([0.01, 0.99, 0.15], () =>
      generateSystemsItemsProcedural(topology),
    );

    expect(generated.roomFailures.length).toBeGreaterThan(0);
    expect(generated.items.length).toBeGreaterThan(0);
    expect(generated.roomFailures[0]?.failures.length).toBeGreaterThan(0);
  });

  it('[M] handles many unique lock IDs by creating one keycard per lock across multiple rooms', () => {
    const topology = makeTopology({
      rooms: [
        ...makeTopology().rooms,
        {
          id: 'room_5',
          archetype: 'restricted',
          connections: ['room_2'],
          lockedBy: 'keycard_gamma',
        },
      ],
    });

    const generated = withRandomSequence([0.7], () => generateSystemsItemsProcedural(topology));
    const keycards = generated.items.filter((item) => item.isKeyItem).map((item) => item.id);

    expect(new Set(keycards)).toEqual(
      new Set(['keycard_alpha', 'keycard_beta', 'keycard_gamma']),
    );
    expect(keycards).toHaveLength(3);
  });

  it('[B] keeps cascade boundary behavior stable for severity-to-timer and target constraints', () => {
    const topology = makeTopology();
    const generated = withRandomSequence([0.3, 0.8, 0.4, 0.6], () =>
      generateSystemsItemsProcedural(topology),
    );

    for (const roomFailure of generated.roomFailures) {
      const room = topology.rooms.find((candidate) => candidate.id === roomFailure.roomId);
      if (!room) throw new Error('fixture room missing');
      for (const failure of roomFailure.failures) {
        if (failure.severity === 1) {
          expect(failure.minutesUntilCascade).toBe(0);
          expect(failure.cascadeTarget).toBeNull();
        }
        if (failure.severity === 2) {
          expect(failure.minutesUntilCascade).toBeGreaterThanOrEqual(60);
          expect(failure.minutesUntilCascade).toBeLessThanOrEqual(120);
        }
        if (failure.severity === 3) {
          expect(failure.minutesUntilCascade).toBeGreaterThanOrEqual(30);
          expect(failure.minutesUntilCascade).toBeLessThanOrEqual(60);
        }
        if (failure.severity >= 2 && failure.cascadeTarget) {
          expect(room.connections).toContain(failure.cascadeTarget);
          expect([topology.entryRoomId, topology.escapeRoomId]).not.toContain(failure.cascadeTarget);
        }
      }
    }
  });

  it('[I] preserves systems-items interface contracts for every generated failure and item field', () => {
    const generated = withRandomSequence([0.42], () =>
      generateSystemsItemsProcedural(makeTopology()),
    );

    const firstFailure = generated.roomFailures[0]?.failures[0];
    const firstItem = generated.items[0];
    expect(firstFailure).toBeDefined();
    expect(firstItem).toBeDefined();
    expect(typeof firstFailure.systemId).toBe('string');
    expect(typeof firstFailure.failureMode).toBe('string');
    expect(typeof firstFailure.severity).toBe('number');
    expect(Array.isArray(firstFailure.requiredMaterials)).toBe(true);
    expect(typeof firstFailure.requiredSkill).toBe('string');
    expect(typeof firstFailure.diagnosisHint).toBe('string');
    expect(Array.isArray(firstFailure.mitigationPaths)).toBe(true);
    expect(typeof firstFailure.minutesUntilCascade).toBe('number');
    expect(typeof firstItem.id).toBe('string');
    expect(typeof firstItem.roomId).toBe('string');
    expect(typeof firstItem.baseItemKey).toBe('string');
    expect(typeof firstItem.isKeyItem).toBe('boolean');
  });

  it('[E] falls back safely when unlocked-reachable placement is absent by still placing keycards', () => {
    const topology = makeTopology({
      rooms: [
        {
          id: 'room_0',
          archetype: 'entry',
          connections: ['room_1'],
          lockedBy: null,
        },
        {
          id: 'room_1',
          archetype: 'utility',
          connections: ['room_0', 'room_2'],
          lockedBy: 'keycard_alpha',
        },
        {
          id: 'room_2',
          archetype: 'escape',
          connections: ['room_1'],
          lockedBy: null,
        },
      ],
      entryRoomId: 'room_0',
      escapeRoomId: 'room_2',
    });

    const generated = withRandomSequence([0.5], () => generateSystemsItemsProcedural(topology));
    const keycards = generated.items.filter((item) => item.id === 'keycard_alpha');

    expect(keycards).toHaveLength(1);
    expect(keycards[0]?.isKeyItem).toBe(true);
  });

  it('[S] follows standard generation flow with reachable materials for every required system repair', () => {
    const topology = makeTopology();
    const generated = withRandomSequence([0.25, 0.15, 0.85, 0.3], () =>
      generateSystemsItemsProcedural(topology),
    );

    for (const roomFailure of generated.roomFailures) {
      for (const failure of roomFailure.failures) {
        const reachabilityError = checkMaterialReachability(
          roomFailure.roomId,
          failure.requiredMaterials,
          generated.items,
          topology.rooms,
          topology.entryRoomId,
        );
        expect(reachabilityError).toBeNull();
      }
    }
  });
});
