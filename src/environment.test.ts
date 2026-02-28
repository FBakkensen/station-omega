import { describe, expect, it } from 'vitest';
import type {
  ActionDifficulty,
  ActionDomain,
  ActiveEvent,
  FailureMode,
  Room,
  SystemFailure,
  SystemId,
} from './types.js';
import { computeEnvironment, EnvironmentTracker } from './environment.js';
import { createTestGameContext } from '../test/fixtures/factories.js';

function fixtureRoom(roomId: string): Room {
  const { context } = createTestGameContext();
  const room = context.station.rooms.get(roomId);
  if (!room) throw new Error(`Missing room fixture: ${roomId}`);
  return structuredClone(room);
}

function makeFailure(
  systemId: SystemId,
  overrides: Partial<SystemFailure> = {},
): SystemFailure {
  return {
    systemId,
    status: 'failing',
    failureMode: 'mechanical',
    severity: 2,
    challengeState: 'detected',
    requiredMaterials: ['insulated_wire'],
    requiredSkill: 'tech' satisfies ActionDomain,
    difficulty: 'moderate' satisfies ActionDifficulty,
    minutesUntilCascade: 30,
    cascadeTarget: null,
    hazardPerMinute: 0.2,
    diagnosisHint: `${systemId} degraded`,
    technicalDetail: '',
    mitigationPaths: ['bypass'],
    ...overrides,
  };
}

function makeEvent(type: ActiveEvent['type']): ActiveEvent {
  return {
    type,
    description: `${type} event`,
    minutesRemaining: 10,
    effect: `${type} effect`,
    resolutionHint: '',
  };
}

describe('environment computation contracts', () => {
  it('[Z] returns default nominal metrics for a room with zero active failures and zero events', () => {
    const room = fixtureRoom('room_1');

    const snapshot = computeEnvironment(room, []);

    expect(snapshot).toMatchObject({
      oxygenPct: 21,
      co2Ppm: 400,
      pressureKpa: 101,
      temperatureC: 22,
      radiationMsv: 0.1,
      structuralPct: 98,
      gravityG: 1.0,
      powerStatus: 'nominal',
      hypoxiaRisk: 'nominal',
      activeFailureCount: 0,
    });
    expect(snapshot.ppO2).toBe(21.2);
  });

  it('[O] applies one life-support failure to a single atmosphere computation', () => {
    const room = fixtureRoom('room_1');
    room.systemFailures = [
      makeFailure('life_support', {
        failureMode: 'contamination' satisfies FailureMode,
      }),
    ];

    const snapshot = computeEnvironment(room, []);

    expect(snapshot.oxygenPct).toBe(18);
    expect(snapshot.co2Ppm).toBe(3000);
    expect(snapshot.activeFailureCount).toBe(1);
    expect(snapshot.hypoxiaRisk).toBe('nominal');
  });

  it('[M] combines many failures with multiple active events across all major environment channels', () => {
    const room = fixtureRoom('room_1');
    room.systemFailures = [
      makeFailure('life_support', { failureMode: 'contamination' }),
      makeFailure('pressure_seal', { failureMode: 'leak' }),
      makeFailure('radiation_shielding', { failureMode: 'structural' }),
      makeFailure('thermal_regulator', { failureMode: 'blockage' }),
      makeFailure('structural_integrity', { failureMode: 'corrosion' }),
      makeFailure('gravity_generator', { failureMode: 'overload' }),
      makeFailure('power_relay', { failureMode: 'overload' }),
    ];
    const events: ActiveEvent[] = [
      makeEvent('hull_breach'),
      makeEvent('atmosphere_alarm'),
      makeEvent('radiation_spike'),
      makeEvent('coolant_leak'),
    ];

    const snapshot = computeEnvironment(room, events);

    expect(snapshot).toMatchObject({
      oxygenPct: 14,
      co2Ppm: 4500,
      pressureKpa: 62,
      temperatureC: 41,
      radiationMsv: 14,
      structuralPct: 55,
      gravityG: 0.6,
      powerStatus: 'intermittent',
      hypoxiaRisk: 'critical',
      activeFailureCount: 7,
    });
    expect(snapshot.ppO2).toBe(8.7);
  });

  it('[B] keeps threshold boundary behavior stable when ppO2 crosses below the hypoxia warning limit', () => {
    const room = fixtureRoom('room_1');
    room.systemFailures = [makeFailure('life_support')];

    const nominal = computeEnvironment(room, []);
    const warning = computeEnvironment(room, [makeEvent('hull_breach')]);

    expect(nominal.ppO2).toBeGreaterThanOrEqual(16);
    expect(nominal.hypoxiaRisk).toBe('nominal');
    expect(warning.ppO2).toBeLessThan(16);
    expect(warning.hypoxiaRisk).toBe('warning');
  });

  it('[I] preserves EnvironmentSnapshot interface contract fields and derived result types', () => {
    const room = fixtureRoom('room_1');
    room.systemFailures = [makeFailure('power_relay')];

    const snapshot = computeEnvironment(room, []);
    const keys = Object.keys(snapshot).sort();

    expect(keys).toEqual([
      'activeFailureCount',
      'co2Ppm',
      'gravityG',
      'hypoxiaRisk',
      'oxygenPct',
      'powerStatus',
      'ppO2',
      'pressureKpa',
      'radiationMsv',
      'structuralPct',
      'temperatureC',
    ]);
    expect(typeof snapshot.oxygenPct).toBe('number');
    expect(typeof snapshot.ppO2).toBe('number');
    expect(['nominal', 'warning', 'critical']).toContain(snapshot.hypoxiaRisk);
    expect(['nominal', 'intermittent']).toContain(snapshot.powerStatus);
  });

  it('[E] tolerates non-environment event types safely without mutating baseline values', () => {
    const room = fixtureRoom('room_1');
    const baseline = computeEnvironment(room, []);

    expect(() => computeEnvironment(room, [makeEvent('distress_signal')])).not.toThrow();
    expect(() => computeEnvironment(room, [makeEvent('supply_cache')])).not.toThrow();

    const distress = computeEnvironment(room, [makeEvent('distress_signal')]);
    const supply = computeEnvironment(room, [makeEvent('supply_cache')]);
    expect(distress).toEqual(baseline);
    expect(supply).toEqual(baseline);
  });

  it('[S] follows standard tracker update flow with stable then falling and rising trend transitions', () => {
    const tracker = new EnvironmentTracker();
    const baselineRoom = fixtureRoom('room_1');

    const first = tracker.update(baselineRoom, []);
    expect(first.trends.oxygenPct).toBe('stable');
    expect(first.trends.co2Ppm).toBe('stable');

    const degradedRoom = fixtureRoom('room_1');
    degradedRoom.systemFailures = [makeFailure('life_support')];
    const second = tracker.update(degradedRoom, [makeEvent('hull_breach')]);
    expect(second.trends.oxygenPct).toBe('falling');
    expect(second.trends.co2Ppm).toBe('rising');
    expect(second.trends.pressureKpa).toBe('falling');

    const third = tracker.update(baselineRoom, []);
    expect(third.trends.oxygenPct).toBe('rising');
    expect(third.trends.co2Ppm).toBe('falling');
    expect(tracker.current()).toEqual(third);
  });
});
