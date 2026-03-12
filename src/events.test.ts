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
  resolveHazardsByRepair,
  resolveHazardsByAction,
  resolveHazardsByItem,
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
    // hull_breach: global 1 O₂/min × 4 min = 4; atmosphere_alarm: local 0.4 × 3 = 1, global 1 × 3 = 3; total = 8
    expect(context.state.oxygen).toBe(92);
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

// ─── Localized Hazard Tests ─────────────────────────────────────────────────

describe('localized hazard lifecycle contracts', () => {
  it('[Z] applies zero local damage when hazard is in a different room', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0', minutesRemaining: 5 }),
    ];

    tracker.tickActiveEvents(context.state, 3);

    // No HP/suit damage — player is not in room_0
    expect(context.state.hp).toBe(100);
    expect(context.state.suitIntegrity).toBe(100);
  });

  it('[O] applies one hazard damage only when player is in the hazard room', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0', minutesRemaining: 10 }),
    ];

    tracker.tickActiveEvents(context.state, 3);

    // hull_breach: 0.4 HP/min × 3 = round(1.2) = 1, 0.15 suit/min × 3 = round(0.45) = 0
    expect(context.state.hp).toBe(99);
    expect(context.state.suitIntegrity).toBe(100);
  });

  it('[M] applies global oxygen drain for multiple off-room hazards but not local damage', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.activeEvents = [
      // hull_breach has globalOxygenDrainPerMinute: 1
      makeEvent('hull_breach', { roomId: 'room_0', minutesRemaining: 10 }),
      // atmosphere_alarm has globalOxygenDrainPerMinute: 1
      makeEvent('atmosphere_alarm', { roomId: 'room_0', minutesRemaining: 10 }),
    ];

    tracker.tickActiveEvents(context.state, 4);

    // Global drain: 2 events × 1 O₂/min × 4 min = 8
    expect(context.state.oxygen).toBe(92);
    // No local damage
    expect(context.state.hp).toBe(100);
    expect(context.state.suitIntegrity).toBe(100);
  });

  it('[B] applies both local and global drain for in-room hazard', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';
    context.state.activeEvents = [
      // hull_breach: oxygenDrainPerMinute=0, globalOxygenDrainPerMinute=1
      makeEvent('hull_breach', { roomId: 'room_0', minutesRemaining: 10 }),
    ];

    tracker.tickActiveEvents(context.state, 4);

    // hull_breach: local O₂ drain=0, global O₂ drain=1/min × 4 min = 4
    expect(context.state.oxygen).toBe(96);
  });

  it('[I] includes roomId and severity in event context output', () => {
    const contextText = getEventContext([
      makeEvent('hull_breach', {
        roomId: 'room_0',
        severity: 'critical',
        minutesRemaining: 8,
        effect: 'hull puncture',
      }),
    ]);

    expect(contextText).toContain('room_0');
    expect(contextText).toContain('critical');
  });

  it('[E] post-cascade failed systems continue dealing hazard damage', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';

    const room = context.station.rooms.get('room_0');
    if (!room) throw new Error('Expected room_0 fixture');
    room.systemFailures = [
      makeFailure('coolant_loop', {
        challengeState: 'failed',
        hazardPerMinute: 2,
        minutesUntilCascade: 0,
      }),
    ];

    const output = tracker.processCascadeEffects(context.state, context.station, 3);

    // Failed system still deals hazard damage: 2 HP/min × 3 min = 6
    expect(context.state.hp).toBe(94);
    expect(context.state.metrics.totalDamageTaken).toBe(6);
    expect(output.some((line) => line.includes('HAZARD: coolant loop'))).toBe(true);
  });

  it('[S] fire_outbreak follows standard damage flow dealing HP, suit, and oxygen damage to room occupant', () => {
    const tracker = new EventTracker();
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';
    context.state.activeEvents = [
      makeEvent('fire_outbreak', { roomId: 'room_0', minutesRemaining: 10 }),
    ];

    tracker.tickActiveEvents(context.state, 2);

    // fire_outbreak: 1 HP/min, 1 suit/min, 2 O₂/min
    expect(context.state.hp).toBe(98);
    expect(context.state.suitIntegrity).toBe(98);
    expect(context.state.oxygen).toBe(96);
  });
});

// ─── Hazard Resolution Tests ─────────────────────────────────────────────────

describe('hazard resolution contracts', () => {
  it('[Z] resolveHazardsByRepair returns empty when no hazards match', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0' }),
    ];

    const resolved = resolveHazardsByRepair(context.state, 'room_0', 'power_relay');

    expect(resolved).toHaveLength(0);
    expect(context.state.activeEvents).toHaveLength(1);
  });

  it('[O] resolveHazardsByRepair clears one matching hazard by system', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0' }),
      makeEvent('fire_outbreak', { roomId: 'room_0' }),
    ];

    // pressure_seal resolves hull_breach
    const resolved = resolveHazardsByRepair(context.state, 'room_0', 'pressure_seal');

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.type).toBe('hull_breach');
    expect(context.state.activeEvents).toHaveLength(1);
    expect(context.state.activeEvents[0]?.type).toBe('fire_outbreak');
  });

  it('[M] resolveHazardsByAction matches action text against multiple tags', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0', severity: 'major' }),
      makeEvent('atmosphere_alarm', { roomId: 'room_0', severity: 'minor' }),
    ];

    // "seal the vent" matches 'seal' for hull_breach and 'vent' for atmosphere_alarm
    const resolved = resolveHazardsByAction(context.state, 'room_0', 'seal the vent panels', false);

    expect(resolved).toHaveLength(2);
    expect(context.state.activeEvents).toHaveLength(0);
  });

  it('[B] stabilize downgrades severity at boundary from critical to major instead of removing', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0', severity: 'critical' }),
    ];

    const resolved = resolveHazardsByAction(context.state, 'room_0', 'seal the breach', true);

    // Stabilize doesn't fully resolve critical — it downgrades
    expect(resolved).toHaveLength(0);
    expect(context.state.activeEvents).toHaveLength(1);
    expect(context.state.activeEvents[0]?.severity).toBe('major');
  });

  it('[I] resolveHazardsByItem maps items to correct hazard types', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0' }),
      makeEvent('coolant_leak', { roomId: 'room_0' }),
    ];

    // sealant_patch resolves hull_breach and atmosphere_alarm, not coolant_leak
    const resolved = resolveHazardsByItem(context.state, 'room_0', 'sealant_patch');

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.type).toBe('hull_breach');
    expect(context.state.activeEvents).toHaveLength(1);
    expect(context.state.activeEvents[0]?.type).toBe('coolant_leak');
  });

  it('[E] resolution safely skips hazards in other rooms without invalid removal', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0' }),
      makeEvent('hull_breach', { roomId: 'room_1' }),
    ];

    const resolved = resolveHazardsByRepair(context.state, 'room_0', 'pressure_seal');

    expect(resolved).toHaveLength(1);
    expect(context.state.activeEvents).toHaveLength(1);
    expect(context.state.activeEvents[0]?.roomId).toBe('room_1');
  });

  it('[S] stabilize follows standard flow to fully resolve minor severity hazards', () => {
    const { context } = createTestGameContext();
    context.state.activeEvents = [
      makeEvent('hull_breach', { roomId: 'room_0', severity: 'minor' }),
    ];

    const resolved = resolveHazardsByAction(context.state, 'room_0', 'seal it up', true);

    expect(resolved).toHaveLength(1);
    expect(context.state.activeEvents).toHaveLength(0);
  });
});
