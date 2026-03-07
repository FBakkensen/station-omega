import { getBuild, initializePlayerState } from '../../src/character.js';
import type {
  CharacterClassId,
  GameState,
  GeneratedStation,
  Item,
  NPC,
  NPCMemory,
  Room,
  SystemFailure,
} from '../../src/types.js';
import type { GameContext } from '../../src/tools.js';

function createNPCMemory(): NPCMemory {
  return {
    playerActions: [],
    dispositionHistory: [],
    wasSpared: false,
    wasHelped: false,
    tradeInventory: [],
  };
}

function createSystemFailure(overrides: Partial<SystemFailure> = {}): SystemFailure {
  return {
    systemId: 'power_relay',
    status: 'failing',
    failureMode: 'overload',
    severity: 2,
    challengeState: 'detected',
    requiredMaterials: ['insulated_wire'],
    requiredSkill: 'tech',
    difficulty: 'moderate',
    minutesUntilCascade: 30,
    cascadeTarget: null,
    hazardPerMinute: 0.2,
    diagnosisHint: 'Voltage instability observed.',
    technicalDetail: 'Panel shows recurrent overcurrent spikes.',
    mitigationPaths: ['reroute power', 'replace relay'],
    ...overrides,
  };
}

export function createTestStation(): GeneratedStation {
  const entryRoom: Room = {
    id: 'room_0',
    archetype: 'entry',
    name: 'Docking Vestibule',
    descriptionSeed: 'Emergency strobes pulse over frost-lined bulkheads.',
    depth: 0,
    connections: ['room_1'],
    lockedBy: null,
    loot: ['item_wire', 'item_keycard'],
    sensory: {
      sounds: ['distant coolant drip'],
      smells: ['ozone'],
      visuals: ['flickering guidance panels'],
      tactile: 'air tastes metallic',
    },
    crewLogs: [],
    isObjectiveRoom: false,
    secretConnection: null,
    roomModifiers: [],
    systemFailures: [createSystemFailure()],
    engineeringNotes: 'Primary relay panel reports intermittent overload.',
  };

  const escapeRoom: Room = {
    id: 'room_1',
    archetype: 'escape',
    name: 'Escape Gantry',
    descriptionSeed: 'A launch cradle waits under red safety lamps.',
    depth: 1,
    connections: ['room_0'],
    lockedBy: 'item_keycard',
    loot: [],
    sensory: {
      sounds: ['hydraulic hiss'],
      smells: ['burnt dust'],
      visuals: ['sealed pod hatch'],
      tactile: 'deck plating vibrates',
    },
    crewLogs: [],
    isObjectiveRoom: true,
    secretConnection: null,
    roomModifiers: [],
    systemFailures: [],
    engineeringNotes: 'Escape controls offline until authorization verified.',
  };

  const npcs = new Map<string, NPC>([
    [
      'npc_0',
      {
        id: 'npc_0',
        name: 'Ari Voss',
        roomId: 'room_0',
        disposition: 'neutral',
        behaviors: new Set(['can_negotiate', 'is_intelligent']),
        memory: createNPCMemory(),
        personality: 'Measured and cautious',
        isAlly: false,
        appearance: 'Grease-streaked suit with cracked visor',
        soundSignature: 'steady clipped tone',
      },
    ],
  ]);

  const items = new Map<string, Item>([
    [
      'item_wire',
      {
        id: 'item_wire',
        name: 'Insulated Wire',
        description: 'Shielded wiring coil rated for high current.',
        category: 'material',
        effect: { type: 'material', value: 1, description: 'Repair material' },
        isKeyItem: false,
        useNarration: 'I feed the wire into the damaged harness.',
      },
    ],
    [
      'item_keycard',
      {
        id: 'item_keycard',
        name: 'Ops Keycard',
        description: 'A chipped command-level access card.',
        category: 'key',
        effect: { type: 'key', value: 0, description: 'Unlocks restricted doors' },
        isKeyItem: true,
        useNarration: 'The keycard reader flashes green.',
      },
    ],
  ]);

  return {
    config: {
      seed: 42,
      difficulty: 'normal',
      storyArc: 'cascade_failure',
      characterClass: 'engineer',
    },
    stationName: 'Test Station',
    briefing: 'Stabilize systems and reach the escape gantry.',
    backstory: 'A maintenance lapse triggered cascading faults across the deck.',
    rooms: new Map([
      ['room_0', entryRoom],
      ['room_1', escapeRoom],
    ]),
    npcs,
    items,
    objectives: {
      storyArc: 'cascade_failure',
      title: 'Restore Evacuation Path',
      steps: [
        {
          id: 'step_0',
          description: 'Diagnose the relay fault in Docking Vestibule.',
          roomId: 'room_0',
          requiredItemId: null,
          requiredSystemRepair: 'power_relay',
          completed: false,
        },
        {
          id: 'step_1',
          description: 'Reach the Escape Gantry.',
          roomId: 'room_1',
          requiredItemId: 'item_keycard',
          requiredSystemRepair: null,
          completed: false,
        },
      ],
      currentStepIndex: 0,
      completed: false,
    },
    entryRoomId: 'room_0',
    escapeRoomId: 'room_1',
    crewRoster: [
      { name: 'Mika Renn', role: 'Chief Engineer', fate: 'Missing' },
      { name: 'Liu Oran', role: 'Pilot', fate: 'Evacuated' },
    ],
    arrivalScenario: {
      playerBackstory: 'You were dispatched as emergency engineering support.',
      arrivalCondition: 'Docked through debris while power fluctuated.',
      knowledgeLevel: 'partial',
      openingLine: 'Helmet lights cut through drifting coolant mist.',
      playerCallsign: 'Vector',
    },
    mapLayout: {
      seed: 42,
      positions: new Map([
        ['room_0', { x: 0, y: 0 }],
        ['room_1', { x: 1, y: 0 }],
      ]),
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0 },
      scaleHint: { dx: 1, dy: 1 },
    },
  };
}

export function createTestState(classId: CharacterClassId = 'engineer'): GameState {
  return initializePlayerState(classId, 'room_0', 'run_test', 'cascade_failure', 'normal');
}

export function createTestGameContext(classId: CharacterClassId = 'engineer'): {
  context: GameContext;
  capturedChoices: Array<{
    title: string;
    choices: {
      label: string;
      description: string;
      risk?: 'low' | 'medium' | 'high' | 'critical';
      timeCost?: string;
      consequence?: string;
    }[];
  }>;
} {
  const station = createTestStation();
  const state = createTestState(classId);
  const build = getBuild(classId);
  const capturedChoices: Array<{
    title: string;
    choices: {
      label: string;
      description: string;
      risk?: 'low' | 'medium' | 'high' | 'critical';
      timeCost?: string;
      consequence?: string;
    }[];
  }> = [];

  const context: GameContext = {
    state,
    station,
    build,
    onChoices: (choiceSet) => {
      capturedChoices.push(choiceSet);
    },
    turnElapsedMinutes: 0,
    cascadeAdvancedMinutes: 0,
  };

  return { context, capturedChoices };
}

export function parseJsonResult(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    throw new Error('Tool result was not a JSON string.');
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
