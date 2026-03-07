import { describe, expect, it } from 'vitest';
import { createTestState, createTestStation } from '../test/fixtures/factories.js';
import {
  formatObjectiveUpdate,
  normalizeObjectiveChain,
  normalizeObjectiveChainWithLegacySupport,
  syncObjectiveProgress,
} from './objectives.js';

describe('objective progression helpers', () => {
  it('[Z] marks zero-step missions complete without revealing phantom steps', () => {
    const station = createTestStation();
    station.objectives.steps = [];
    station.objectives.currentStepIndex = 99;
    station.objectives.completed = false;

    normalizeObjectiveChain(station.objectives);

    expect(station.objectives.completed).toBe(true);
    expect(station.objectives.currentStepIndex).toBe(0);
  });

  it('[O] reveals only the first pending step for a single-step mission', () => {
    const station = createTestStation();
    station.objectives.steps = [station.objectives.steps[0]];
    station.objectives.steps[0].revealed = false;
    station.objectives.currentStepIndex = 4;

    normalizeObjectiveChain(station.objectives);

    expect(station.objectives.steps[0].revealed).toBe(true);
    expect(station.objectives.currentStepIndex).toBe(0);
    expect(station.objectives.completed).toBe(false);
  });

  it('[M] chains through many latent completions once the blocking step resolves', () => {
    const station = createTestStation();
    const state = createTestState();
    station.objectives.steps.splice(1, 0, {
      id: 'step_1b',
      description: 'Secure the Ops Keycard in Docking Vestibule.',
      roomId: 'room_0',
      requiredItemId: 'item_keycard',
      requiredSystemRepair: null,
      revealed: false,
      completed: false,
    });
    station.objectives.steps[2].id = 'step_2';
    station.objectives.steps[2].revealed = false;
    station.objectives.currentStepIndex = 0;

    state.inventory.push('item_keycard');

    const hiddenProgress = syncObjectiveProgress(state, station);
    expect(station.objectives.steps[1].completed).toBe(true);
    expect(station.objectives.steps[1].revealed).toBe(false);
    expect(formatObjectiveUpdate(hiddenProgress)).toBeNull();
    expect(station.objectives.currentStepIndex).toBe(0);

    const relayFailure = station.rooms.get('room_0')?.systemFailures.find((failure) => failure.systemId === 'power_relay');
    if (!relayFailure) throw new Error('Expected power_relay fixture');
    relayFailure.challengeState = 'resolved';
    relayFailure.status = 'repaired';

    const unlockedProgress = syncObjectiveProgress(state, station);

    expect(station.objectives.currentStepIndex).toBe(2);
    expect(station.objectives.steps[1].revealed).toBe(true);
    expect(station.objectives.steps[2].revealed).toBe(true);
    expect(unlockedProgress?.newlyCompletedSteps.map((step) => step.id)).toEqual(['step_0', 'step_1b']);
    expect(unlockedProgress?.activeStep?.id).toBe('step_2');
  });

  it('[B] normalizes legacy reveal metadata at the current-step boundary', () => {
    const station = createTestStation();
    const legacySteps = station.objectives.steps as unknown as Array<
      Omit<typeof station.objectives.steps[number], 'revealed'> & { revealed?: boolean }
    >;
    legacySteps[0].completed = true;
    Reflect.deleteProperty(legacySteps[0], 'revealed');
    Reflect.deleteProperty(legacySteps[1], 'revealed');
    station.objectives.currentStepIndex = 99;

    normalizeObjectiveChainWithLegacySupport(station.objectives);

    expect(station.objectives.currentStepIndex).toBe(1);
    expect(station.objectives.steps[0].revealed).toBe(true);
    expect(station.objectives.steps[1].revealed).toBe(true);
  });

  it('[I] preserves the objective update interface by withholding hidden completed future steps until reveal', () => {
    const station = createTestStation();
    const state = createTestState();
    station.objectives.steps.splice(1, 0, {
      id: 'step_hidden',
      description: 'Pocket the keycard before the relay comes back online.',
      roomId: 'room_0',
      requiredItemId: 'item_keycard',
      requiredSystemRepair: null,
      revealed: false,
      completed: false,
    });
    station.objectives.steps[2].revealed = false;

    state.inventory.push('item_keycard');

    const progress = syncObjectiveProgress(state, station);

    expect(progress).toBeNull();
    expect(formatObjectiveUpdate(progress)).toBeNull();
  });

  it('[E] returns null without errors when no objective state changes occur during sync', () => {
    const station = createTestStation();
    const state = createTestState();
    state.currentRoom = 'room_1';

    expect(syncObjectiveProgress(state, station)).toBeNull();
  });

  it('[S] completes the standard visible step and reveals the next one', () => {
    const station = createTestStation();
    const state = createTestState();
    const relayFailure = station.rooms.get('room_0')?.systemFailures.find((failure) => failure.systemId === 'power_relay');
    if (!relayFailure) throw new Error('Expected power_relay fixture');
    relayFailure.challengeState = 'resolved';
    relayFailure.status = 'repaired';

    const progress = syncObjectiveProgress(state, station);

    expect(progress?.newlyCompletedSteps.map((step) => step.id)).toEqual(['step_0']);
    expect(progress?.activeStep?.id).toBe('step_1');
    expect(station.objectives.steps[1].revealed).toBe(true);
    expect(formatObjectiveUpdate(progress)).toContain('Next: "Reach the Escape Gantry."');
  });
});
