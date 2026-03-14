import { describe, expect, it } from 'vitest';
import { assembleStation } from './assembly.js';
import type {
  CreativeContent,
  StationSkeleton,
  SystemFailureSkeleton,
  SystemStatus,
} from './types.js';

function makeFailureSkeleton(
  overrides: Partial<SystemFailureSkeleton> = {},
): SystemFailureSkeleton {
  return {
    systemId: 'power_relay',
    failureMode: 'overload',
    severity: 2,
    requiredMaterials: ['insulated_wire'],
    requiredSkill: 'tech',
    difficulty: 'moderate',
    minutesUntilCascade: 80,
    cascadeTarget: 'room_2',
    hazardPerMinute: 0.2,
    diagnosisHint: 'Voltage spikes detected.',
    mitigationPaths: ['reroute bus'],
    ...overrides,
  };
}

function makeSkeleton(overrides: Partial<StationSkeleton> = {}): StationSkeleton {
  return {
    config: {
      seed: 4242,
      difficulty: 'normal',
      storyArc: 'cascade_failure',
      characterClass: 'engineer',
    },
    rooms: [
      {
        id: 'room_0',
        archetype: 'entry',
        depth: 0,
        connections: ['room_1'],
        lockedBy: null,
        lootSlots: [],
        isObjectiveRoom: false,
        secretConnection: null,
        systemFailures: [makeFailureSkeleton({ severity: 1 })],
      },
      {
        id: 'room_1',
        archetype: 'utility',
        depth: 1,
        connections: ['room_0', 'room_2'],
        lockedBy: null,
        lootSlots: [
          {
            id: 'item_wire',
            category: 'material',
            effect: {
              type: 'material',
              value: 1,
              description: 'insulated wire',
            },
            isKeyItem: false,
          },
        ],
        isObjectiveRoom: true,
        secretConnection: null,
        systemFailures: [makeFailureSkeleton({ severity: 2 })],
      },
      {
        id: 'room_2',
        archetype: 'escape',
        depth: 2,
        connections: ['room_1'],
        lockedBy: 'keycard_ops',
        lootSlots: [],
        isObjectiveRoom: true,
        secretConnection: null,
        systemFailures: [makeFailureSkeleton({ severity: 3 })],
      },
    ],
    items: [
      {
        id: 'item_wire',
        category: 'material',
        effect: {
          type: 'material',
          value: 1,
          description: 'insulated wire',
        },
        isKeyItem: false,
      },
      {
        id: 'keycard_ops',
        category: 'key',
        effect: {
          type: 'key',
          value: 0,
          description: 'ops keycard',
        },
        isKeyItem: true,
      },
    ],
    objectives: {
      storyArc: 'cascade_failure',
      title: 'Restore Path',
      briefing: 'Stabilize utility systems and reach extraction.',
      steps: [
        {
          id: 'step_0',
          description: 'Stabilize utility systems',
          roomId: 'room_1',
          requiredItemId: 'item_wire',
          requiredSystemRepair: 'power_relay',
          revealed: true,
          completed: false,
        },
        {
          id: 'step_1',
          description: 'Reach extraction',
          roomId: 'room_2',
          requiredItemId: 'keycard_ops',
          requiredSystemRepair: null,
          revealed: false,
          completed: false,
        },
      ],
      currentStepIndex: 0,
      completed: false,
    },
    entryRoomId: 'room_0',
    escapeRoomId: 'room_2',
    scenario: {
      theme: 'Power cascade',
      centralTension: 'Relays are failing station-wide.',
    },
    ...overrides,
  };
}

function makeCreative(overrides: Partial<CreativeContent> = {}): CreativeContent {
  return {
    stationName: 'Tachyon Drift',
    briefing: 'Restore failing systems and extract.',
    backstory: 'A relay surge fractured power distribution.',
    crewRoster: [{ name: 'Nara Ives', role: 'Chief Engineer', fate: 'Missing' }],
    rooms: [
      {
        roomId: 'room_0',
        name: 'Docking Vestibule',
        descriptionSeed: 'Cold lights flicker.',
        sensory: {
          sounds: ['low hum'],
          smells: ['ozone'],
          visuals: ['flicker'],
          tactile: 'metal deck',
        },
        crewLogs: [],
        engineeringNotes: 'Entry diagnostics nominal.',
      },
      {
        roomId: 'room_1',
        name: 'Relay Trench',
        descriptionSeed: 'Cable runs spark intermittently.',
        sensory: {
          sounds: ['arcing'],
          smells: ['burnt insulation'],
          visuals: ['sparks'],
          tactile: 'warm air',
        },
        crewLogs: [],
        engineeringNotes: 'Bus load unstable.',
      },
    ],
    items: [
      {
        itemId: 'item_wire',
        name: 'Insulated Wire Coil',
        description: 'High-gauge repair wire.',
        useNarration: 'You splice fresh wire into the relay harness.',
      },
    ],
    arrivalScenario: {
      playerBackstory: 'You were dispatched as emergency engineering support.',
      arrivalCondition: 'Docking clamps engaged under rotating alarms.',
      knowledgeLevel: 'partial',
      openingLine: 'Helmet lights cut through coolant haze.',
      playerCallsign: 'Vector',
    },
    startingItem: {
      id: 'start_multitool',
      name: 'Starter Multitool',
      description: 'Compact diagnostic and repair kit.',
      effectDescription: 'starter multitool',
      category: 'tool',
      effectType: 'tool',
      effectValue: 1,
      useNarration: 'You palm the multitool and run a quick check.',
    },
    ...overrides,
  };
}

describe('assembleStation contracts', () => {
  it('[Z] assembles zero optional people systems without adding phantom records', () => {
    const skeleton = makeSkeleton();
    const creative = makeCreative();

    const station = assembleStation(skeleton, creative);

    expect(station.rooms.size).toBe(3);
    expect(station.items.has('start_multitool')).toBe(true);
  });

  it('[O] applies one creative room and item override while preserving source IDs', () => {
    const skeleton = makeSkeleton();
    const creative = makeCreative();

    const station = assembleStation(skeleton, creative);

    expect(station.rooms.get('room_1')?.name).toBe('Relay Trench');
    expect(station.items.get('item_wire')?.name).toBe('Insulated Wire Coil');
    expect(station.rooms.has('room_1')).toBe(true);
    expect(station.items.has('item_wire')).toBe(true);
  });

  it('[M] assembles many room mappings and keeps map layout positions for every room id', () => {
    const skeleton = makeSkeleton({
      rooms: [
        ...makeSkeleton().rooms,
        {
          id: 'room_3',
          archetype: 'cargo',
          depth: 2,
          connections: ['room_1'],
          lockedBy: null,
          lootSlots: [],
          isObjectiveRoom: false,
          secretConnection: null,
          systemFailures: [],
        },
      ],
    });
    const creative = makeCreative();

    const station = assembleStation(skeleton, creative);

    expect(station.rooms.size).toBe(4);
    expect(station.mapLayout.positions.size).toBe(4);
    expect(station.mapLayout.positions.has('room_3')).toBe(true);
  });

  it('[B] maps failure severity boundaries to stable status thresholds', () => {
    const station = assembleStation(makeSkeleton(), makeCreative());
    const statuses = ['room_0', 'room_1', 'room_2'].map((id) =>
      station.rooms.get(id)?.systemFailures[0]?.status,
    ) as SystemStatus[];

    expect(statuses).toEqual(['degraded', 'failing', 'critical']);
  });

  it('[I] preserves objective contract fields and avoids shared-reference mutation invariants', () => {
    const skeleton = makeSkeleton();
    const station = assembleStation(skeleton, makeCreative());
    const firstStationStep = station.objectives.steps[0];
    const firstSkeletonStep = skeleton.objectives.steps[0];

    firstStationStep.completed = true;

    expect(firstStationStep.id).toBe('step_0');
    expect(firstSkeletonStep.completed).toBe(false);
    expect(station.objectives.steps.length).toBe(skeleton.objectives.steps.length);
  });

  it('[E] tolerates invalid entry room references without throwing and without misplaced starter loot', () => {
    const skeleton = makeSkeleton({ entryRoomId: 'missing_room' });

    expect(() => assembleStation(skeleton, makeCreative())).not.toThrow();
    const station = assembleStation(skeleton, makeCreative());

    const lootLists = [...station.rooms.values()].map((room) => room.loot);
    const totalStarterInstances = lootLists
      .flat()
      .filter((itemId) => itemId === 'start_multitool').length;
    expect(totalStarterInstances).toBe(0);
  });

  it('[S] follows standard assembly flow by placing starter gear in the configured entry room', () => {
    const station = assembleStation(makeSkeleton(), makeCreative());
    const entryLoot = station.rooms.get('room_0')?.loot ?? [];

    expect(entryLoot).toContain('start_multitool');
    expect(station.items.get('start_multitool')?.name).toBe('Starter Multitool');
  });
});
