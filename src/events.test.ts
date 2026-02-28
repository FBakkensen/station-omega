import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveEvent,
  SystemFailure,
  SystemId,
} from './types.js';
import {
  EventTracker,
  advanceCascadeCountdowns,
  getEventContext,
} from './events.js';
import { createTestGameContext } from '../test/fixtures/factories.js';

function makeEvent(
  type: ActiveEvent['type'],
  overrides: Partial<ActiveEvent> = {},
): ActiveEvent {
  return {
    type,
    description: `${type} active`,
    minutesRemaining: 10,
    effect: `${type} effect`,
    resolutionHint: '',
    ...overrides,
  };
}

function makeFailure(systemId: SystemId, overrides: Partial<SystemFailure> = {}): SystemFailure {
  return {
    systemId,
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
    diagnosisHint: 'unstable',
    technicalDetail: '',
    mitigationPaths: ['reroute'],
    ...overrides,
  };
}

describe('event system contracts', () => {
  it('[Z] returns zero random events when mission elapsed time is below minimum thresholds', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.missionElapsedMinutes = 0;

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const event = tracker.checkRandomEvent(context.state);
      expect(event).toBeNull();
      expect(tracker.lastTriggered.size).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('[O] triggers one eligible power-failure event with deterministic first-roll inputs', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.missionElapsedMinutes = 50;

    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy
      .mockReturnValueOnce(0) // probability check
      .mockReturnValueOnce(0) // duration selection
      .mockReturnValueOnce(0); // hint selection
    try {
      const event = tracker.checkRandomEvent(context.state);
      expect(event?.type).toBe('power_failure');
      expect(event?.minutesRemaining).toBe(20);
      expect(event?.resolutionHint).toContain('Backup capacitor bank');
      expect(tracker.lastTriggered.get('power_failure')).toBe(50);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('[M] processes many active events in one tick and preserves multi-event state progression', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', {
        minutesRemaining: 5,
        effect: 'decompression — HP and suit integrity drain continuously',
        resolutionHint: 'Hull foam sealed the puncture',
      }),
      makeEvent('atmosphere_alarm', {
        minutesRemaining: 3,
        effect: 'atmosphere processor struggling — oxygen draining continuously',
        resolutionHint: 'Backup scrubber took over',
      }),
      makeEvent('power_failure', {
        minutesRemaining: 2,
        effect: 'station power grid offline — visibility severely limited, instruments dark',
        resolutionHint: 'Capacitors recovered',
      }),
    ];

    const output = tracker.tickActiveEvents(context.state, 4);

    expect(context.state.hp).toBe(98);
    expect(context.state.suitIntegrity).toBe(99);
    expect(context.state.oxygen).toBe(99);
    expect(context.state.metrics.totalDamageTaken).toBe(2);
    expect(context.state.activeEvents).toHaveLength(1);
    expect(context.state.activeEvents[0]?.type).toBe('hull_breach');
    expect(context.state.activeEvents[0]?.minutesRemaining).toBe(1);
    expect(output.some((line) => line.includes('HULL BREACH'))).toBe(true);
    expect(output.some((line) => line.includes('ATMOSPHERE ALARM'))).toBe(true);
    expect(output.some((line) => line.includes('POWER FAILURE'))).toBe(true);
    expect(output.some((line) => line.includes('Event resolved: atmosphere alarm'))).toBe(true);
    expect(output.some((line) => line.includes('Event resolved: power failure'))).toBe(true);
  });

  it('[B] keeps cascade countdown boundary behavior stable for detected vs stabilized vs resolved failures', () => {
    const { context } = createTestGameContext();
    const room = context.station.rooms.get('room_0');
    if (!room) throw new Error('Expected room_0 fixture');
    room.systemFailures = [
      makeFailure('power_relay', { challengeState: 'detected', minutesUntilCascade: 10 }),
      makeFailure('coolant_loop', { challengeState: 'stabilized', minutesUntilCascade: 10 }),
      makeFailure('life_support', { challengeState: 'resolved', minutesUntilCascade: 10 }),
      makeFailure('pressure_seal', { challengeState: 'failed', minutesUntilCascade: 10 }),
    ];

    advanceCascadeCountdowns(context.station, 6);

    expect(room.systemFailures[0]?.minutesUntilCascade).toBe(4);
    expect(room.systemFailures[1]?.minutesUntilCascade).toBe(7);
    expect(room.systemFailures[2]?.minutesUntilCascade).toBe(10);
    expect(room.systemFailures[3]?.minutesUntilCascade).toBe(10);
  });

  it('[I] formats active-event context with interface heading and structured bullet lines', () => {
    const contextText = getEventContext([
      makeEvent('power_failure', {
        minutesRemaining: 12,
        effect: 'station bus unstable',
        resolutionHint: 'Backup capacitor engaged',
      }),
      makeEvent('coolant_leak', {
        minutesRemaining: 6,
        effect: 'coolant on floor',
        resolutionHint: '',
      }),
    ]);

    expect(contextText.startsWith('## Active Station Events')).toBe(true);
    expect(contextText).toContain('**POWER FAILURE** (12 min remaining): station bus unstable.');
    expect(contextText).toContain('Recovery mechanism: backup capacitor engaged.');
    expect(contextText).toContain('**COOLANT LEAK** (6 min remaining): coolant on floor.');
  });

  it('[E] marks game over with explicit failure diagnostics when hazard damage exceeds survival thresholds', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';
    context.state.hp = 2;

    const room = context.station.rooms.get('room_0');
    if (!room) throw new Error('Expected room_0 fixture');
    room.systemFailures = [
      makeFailure('coolant_loop', {
        hazardPerMinute: 3,
        minutesUntilCascade: 10,
      }),
    ];

    const output = tracker.processCascadeEffects(context.state, context.station, 1);

    expect(context.state.hp).toBe(0);
    expect(context.state.gameOver).toBe(true);
    expect(context.state.metrics.deathCause).toBe('System hazard: coolant_loop');
    expect(context.state.metrics.totalDamageTaken).toBe(3);
    expect(output).toContain('HAZARD: coolant loop failure dealing 3 damage over 1 min.');
  });

  it('[S] follows standard cascade flow by failing expired systems and propagating to target rooms', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();

    const sourceRoom = context.station.rooms.get('room_0');
    const targetRoom = context.station.rooms.get('room_1');
    if (!sourceRoom || !targetRoom) throw new Error('Expected room fixtures');

    sourceRoom.systemFailures = [
      makeFailure('power_relay', {
        severity: 2,
        minutesUntilCascade: 0,
        cascadeTarget: 'room_1',
        diagnosisHint: 'Relay overtemp',
      }),
    ];

    const targetBefore = targetRoom.systemFailures.length;
    const output = tracker.processCascadeEffects(context.state, context.station, 1);

    expect(sourceRoom.systemFailures[0]?.challengeState).toBe('failed');
    expect(sourceRoom.systemFailures[0]?.status).toBe('offline');
    expect(context.state.systemsCascaded).toBe(1);
    expect(context.state.metrics.systemsCascaded).toBe(1);
    expect(output.some((line) => line.includes('CASCADE: power relay'))).toBe(true);
    expect(output.some((line) => line.includes('WARNING: power relay failure has propagated to Escape Gantry'))).toBe(true);
    expect(targetRoom.systemFailures.length).toBe(targetBefore + 1);
    const appended = targetRoom.systemFailures[targetRoom.systemFailures.length - 1];
    expect(appended.systemId).toBe('power_relay');
    expect(appended.challengeState).toBe('detected');
    expect(appended.severity).toBe(3);
    expect(appended.diagnosisHint).toContain('Cascaded from Docking Vestibule');
  });
});
