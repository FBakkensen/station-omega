import { describe, expect, it } from 'vitest';
import {
  extractGameStatus,
  type ConvexGameDoc,
  type ConvexStationDoc,
} from './gameplay-status';

function buildDocs(): { game: ConvexGameDoc; station: ConvexStationDoc } {
  return {
    game: {
      state: {
        hp: 95,
        maxHp: 100,
        oxygen: 88,
        maxOxygen: 100,
        suitIntegrity: 90,
        characterClass: 'engineer',
        missionElapsedMinutes: 12,
        currentRoom: 'room_0',
        roomsVisited: ['room_0'],
        inventory: ['item_0'],
        maxInventory: 6,
        activeEvents: [{ type: 'cascade_failure', minutesRemaining: 15, effect: 'pressure drop' }],
      },
      isOver: false,
      won: false,
      turnCount: 2,
      characterClass: 'engineer',
      difficulty: 'normal',
    },
    station: {
      stationName: 'Test Station',
      data: {
        rooms: {
          room_0: {
            id: 'room_0',
            name: 'Docking Vestibule',
            archetype: 'entry',
            connections: ['room_1'],
            depth: 0,
            systemFailures: [
              {
                systemId: 'power_relay',
                status: 'failing',
                challengeState: 'detected',
                severity: 2,
                minutesUntilCascade: 12,
              },
            ],
          },
        },
        items: {
          item_0: { name: 'Insulated Wire', isKeyItem: false },
        },
        objectives: {
          title: 'Restore Main Relay',
          steps: [
            { description: 'Diagnose the relay', completed: true, revealed: true },
            { description: 'Repair the relay', completed: false, revealed: true },
          ],
          currentStepIndex: 1,
          completed: false,
        },
      },
    },
  };
}

function requireGameState(game: ConvexGameDoc): NonNullable<ConvexGameDoc['state']> {
  if (!game.state) throw new Error('missing game.state fixture');
  return game.state;
}

function requireStationData(station: ConvexStationDoc): NonNullable<ConvexStationDoc['data']> {
  if (!station.data) throw new Error('missing station.data fixture');
  return station.data;
}

describe('extractGameStatus', () => {
  it('[Z] returns null when game and station docs are absent', () => {
    expect(extractGameStatus(null, null)).toBeNull();
  });

  it('[O] maps minimal valid docs into sidebar status', () => {
    const { game, station } = buildDocs();
    const status = extractGameStatus(game, station);
    expect(status?.roomName).toBe('Docking Vestibule');
    expect(status?.objectiveTitle).toBe('Restore Main Relay');
  });

  it('[M] translates larger inventories and objective step arrays', () => {
    const { game, station } = buildDocs();
    const state = requireGameState(game);
    const stationData = requireStationData(station);
    state.inventory = ['item_0', 'item_1', 'item_2'];
    stationData.items = {
      item_0: { name: 'Insulated Wire', isKeyItem: false },
      item_1: { name: 'Ops Keycard', isKeyItem: true },
      item_2: { name: 'Sealant Patch', isKeyItem: false },
    };
    const objectives = stationData.objectives;
    if (!objectives) throw new Error('missing objectives fixture');
    objectives.steps.push({ description: 'Reach escape', completed: false, revealed: false });

    const status = extractGameStatus(game, station);
    expect(status?.inventory).toEqual(['Insulated Wire', 'Ops Keycard', 'Sealant Patch']);
    expect(status?.objectiveTotal).toBe(3);
    expect(status?.objectiveSteps).toHaveLength(2);
  });

  it('[B] handles out-of-range objective index safely', () => {
    const { game, station } = buildDocs();
    const objectives = requireStationData(station).objectives;
    if (!objectives) throw new Error('missing objectives fixture');
    objectives.currentStepIndex = 99;
    const status = extractGameStatus(game, station);
    expect(status?.objectiveCurrentDesc).toBe('Repair the relay');
  });

  it('[I] preserves the GameStatusData contract fields used by sidebar', () => {
    const { game, station } = buildDocs();
    const status = extractGameStatus(game, station);
    expect(status).toMatchObject({
      hp: 95,
      maxHp: 100,
      oxygen: 88,
      suitIntegrity: 90,
      objectiveStep: 2,
      objectiveTotal: 2,
    });
  });

  it('[E] returns null when station.data is missing', () => {
    const { game, station } = buildDocs();
    delete station.data;
    expect(extractGameStatus(game, station)).toBeNull();
  });

  it('[S] derives key-item flags alongside inventory labels', () => {
    const { game, station } = buildDocs();
    const state = requireGameState(game);
    const stationData = requireStationData(station);
    state.inventory = ['item_0', 'item_key'];
    stationData.items = {
      item_0: { name: 'Insulated Wire', isKeyItem: false },
      item_key: { name: 'Ops Keycard', isKeyItem: true },
    };

    const status = extractGameStatus(game, station);
    expect(status?.inventoryKeyFlags).toEqual([false, true]);
  });

  it('[O] hides unrevealed future steps from the mission checklist', () => {
    const { game, station } = buildDocs();
    const objectives = requireStationData(station).objectives;
    if (!objectives) throw new Error('missing objectives fixture');
    objectives.steps.push({ description: 'Launch evac shuttle', completed: false, revealed: false });

    const status = extractGameStatus(game, station);

    expect(status?.objectiveCurrentDesc).toBe('Repair the relay');
    expect(status?.objectiveSteps).toEqual([
      { description: 'Diagnose the relay', completed: true },
      { description: 'Repair the relay', completed: false },
    ]);
  });

  it('[E] falls back to completed-prefix visibility when revealed flags are missing', () => {
    const { game, station } = buildDocs();
    const objectives = requireStationData(station).objectives;
    if (!objectives) throw new Error('missing objectives fixture');
    objectives.steps = [
      { description: 'Diagnose the relay', completed: true },
      { description: 'Repair the relay', completed: false },
      { description: 'Launch evac shuttle', completed: false },
    ];

    const status = extractGameStatus(game, station);

    expect(status?.objectiveSteps).toEqual([
      { description: 'Diagnose the relay', completed: true },
      { description: 'Repair the relay', completed: false },
    ]);
    expect(status?.objectiveCurrentDesc).toBe('Repair the relay');
  });
});

describe('extractGameStatus step ids', () => {
  it('[Z] returns steps with zero/absent id when step has no id field', () => {
    const { game, station } = buildDocs();
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps[0].id).toBeUndefined();
  });

  it('[O] passes through step id when objectivesOverride includes id', () => {
    const { game, station } = buildDocs();
    game.objectivesOverride = {
      title: 'Test',
      steps: [
        { id: 'step_0', description: 'Do the thing', completed: true, revealed: true },
        { id: 'step_1', description: 'Do another thing', completed: false, revealed: true },
      ],
      currentStepIndex: 1,
      completed: false,
    };
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps[0].id).toBe('step_0');
    expect(status?.objectiveSteps[1].id).toBe('step_1');
  });

  it('[M] passes through multiple step ids across revealed steps', () => {
    const { game, station } = buildDocs();
    game.objectivesOverride = {
      title: 'Multi',
      steps: [
        { id: 'a', description: 'Step A', completed: true, revealed: true },
        { id: 'b', description: 'Step B', completed: true, revealed: true },
        { id: 'c', description: 'Step C', completed: false, revealed: true },
        { id: 'd', description: 'Step D', completed: false, revealed: false },
      ],
      currentStepIndex: 2,
      completed: false,
    };
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps).toHaveLength(3);
    expect(status?.objectiveSteps.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('[B] handles mix of steps with and without id fields', () => {
    const { game, station } = buildDocs();
    game.objectivesOverride = {
      title: 'Mix',
      steps: [
        { id: 'has_id', description: 'Has ID', completed: true, revealed: true },
        { description: 'No ID', completed: false, revealed: true },
      ],
      currentStepIndex: 1,
      completed: false,
    };
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps[0].id).toBe('has_id');
    expect(status?.objectiveSteps[1].id).toBeUndefined();
  });

  it('[I] interface invariant: step id from objectivesOverride takes precedence over station.data.objectives', () => {
    const { game, station } = buildDocs();
    const stationData = requireStationData(station);
    if (stationData.objectives) {
      stationData.objectives.steps = [
        { id: 'station_id', description: 'Station step', completed: true, revealed: true },
        { description: 'Station step 2', completed: false, revealed: true },
      ];
    }
    game.objectivesOverride = {
      title: 'Override',
      steps: [
        { id: 'override_id', description: 'Override step', completed: true, revealed: true },
        { id: 'override_2', description: 'Override step 2', completed: false, revealed: true },
      ],
      currentStepIndex: 1,
      completed: false,
    };
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps[0].id).toBe('override_id');
  });

  it('[E] returns null when station data missing (verify no id regression)', () => {
    const { game, station } = buildDocs();
    delete station.data;
    expect(extractGameStatus(game, station)).toBeNull();
  });

  it('[S] returns complete step data including id, description, and completed', () => {
    const { game, station } = buildDocs();
    game.objectivesOverride = {
      title: 'Complete',
      steps: [
        { id: 'step_final', description: 'Final step', completed: true, revealed: true },
      ],
      currentStepIndex: 0,
      completed: true,
    };
    const status = extractGameStatus(game, station);
    expect(status?.objectiveSteps[0]).toEqual({
      id: 'step_final',
      description: 'Final step',
      completed: true,
    });
  });
});
