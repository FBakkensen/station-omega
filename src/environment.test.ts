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
import { computeEnvironment, EnvironmentTracker, tickEnvironmentDamage } from './environment.js';
import type { EnvironmentSnapshot } from './environment.js';
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

  it('[S] follows standard tracker update flow with fire_outbreak modifying temperature and oxygen', () => {
    const room = fixtureRoom('room_1');

    const baseline = computeEnvironment(room, []);
    const withFire = computeEnvironment(room, [makeEvent('fire_outbreak')]);

    expect(withFire.temperatureC).toBe(baseline.temperatureC + 12);
    expect(withFire.oxygenPct).toBe(Math.max(14, baseline.oxygenPct - 3));
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

// ─── Environment Damage Tick Tests ──────────────────────────────────────────

function nominalSnapshot(overrides: Partial<EnvironmentSnapshot> = {}): EnvironmentSnapshot {
  return {
    oxygenPct: 21,
    co2Ppm: 400,
    pressureKpa: 101,
    temperatureC: 22,
    radiationMsv: 0.1,
    structuralPct: 98,
    gravityG: 1.0,
    powerStatus: 'nominal',
    ppO2: 21.2,
    hypoxiaRisk: 'nominal',
    activeFailureCount: 0,
    ...overrides,
  };
}

describe('tickEnvironmentDamage threshold contracts', () => {
  it('[Z] deals zero damage when all environment metrics are nominal', () => {
    const { context } = createTestGameContext();
    const snapshot = nominalSnapshot();

    const result = tickEnvironmentDamage(context.state, snapshot, 5);

    expect(result.hpDamage).toBe(0);
    expect(result.suitDamage).toBe(0);
    expect(result.oxygenDrain).toBe(0);
    expect(result.messages).toHaveLength(0);
    expect(context.state.hp).toBe(100);
  });

  it('[O] applies a single warning-level ppO2 (12-16 kPa) oxygen drain without HP damage', () => {
    const { context } = createTestGameContext();
    const snapshot = nominalSnapshot({ ppO2: 14.5, hypoxiaRisk: 'warning' });

    const result = tickEnvironmentDamage(context.state, snapshot, 3);

    expect(result.oxygenDrain).toBe(3);
    expect(result.hpDamage).toBe(0);
    expect(context.state.oxygen).toBe(97);
  });

  it('[M] combines multiple hazards: hypoxia, decompression, and extreme temperature damage in one tick', () => {
    const { context } = createTestGameContext();
    context.state.suitIntegrity = 0;
    const snapshot = nominalSnapshot({
      ppO2: 10,
      hypoxiaRisk: 'critical',
      pressureKpa: 65,
      temperatureC: 48,
    });

    const result = tickEnvironmentDamage(context.state, snapshot, 2);

    // ppO2<12 + suit=0: 2*2=4 HP + 1*2=2 O2
    // pressure<70 + suit=0: 3*2=6 HP
    // temp>=45: 1*2=2 HP + 1*2=2 suit
    expect(result.oxygenDrain).toBe(2);
    expect(result.hpDamage).toBe(4 + 6 + 2);
    expect(result.suitDamage).toBe(2);
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('[B] applies correct pressure rates at the 70 kPa and 85 kPa boundaries', () => {
    const { context: ctx1 } = createTestGameContext();
    // Just below 85 kPa with suit — 1 suit/min
    const result85 = tickEnvironmentDamage(ctx1.state, nominalSnapshot({ pressureKpa: 84 }), 2);
    expect(result85.suitDamage).toBe(2);
    expect(result85.hpDamage).toBe(0);

    const { context: ctx2 } = createTestGameContext();
    // Just below 70 kPa with suit — 2 suit/min
    const result70 = tickEnvironmentDamage(ctx2.state, nominalSnapshot({ pressureKpa: 69 }), 2);
    expect(result70.suitDamage).toBe(4);
    expect(result70.hpDamage).toBe(0);

    // Below 70 kPa with suit=0 — 3 HP/min
    const { context: ctx3 } = createTestGameContext();
    ctx3.state.suitIntegrity = 0;
    const resultBreach = tickEnvironmentDamage(ctx3.state, nominalSnapshot({ pressureKpa: 65 }), 2);
    expect(resultBreach.hpDamage).toBe(6);
  });

  it('[I] returns EnvironmentDamageResult with required fields and sets game over on lethal damage', () => {
    const { context } = createTestGameContext();
    context.state.hp = 3;
    context.state.suitIntegrity = 0;
    const snapshot = nominalSnapshot({ pressureKpa: 60 });

    const result = tickEnvironmentDamage(context.state, snapshot, 2);

    expect(result).toHaveProperty('hpDamage');
    expect(result).toHaveProperty('suitDamage');
    expect(result).toHaveProperty('oxygenDrain');
    expect(result).toHaveProperty('messages');
    expect(context.state.gameOver).toBe(true);
    expect(context.state.hp).toBe(0);
    // With pressure < 70 and suit=0, death cause is suit failure decompression
    expect(context.state.metrics.deathCause).toBe('Suit failure — decompression');
  });

  it('[E] triggers suit failure death when suit hits zero under severe decompression', () => {
    const { context } = createTestGameContext();
    context.state.suitIntegrity = 1;
    const snapshot = nominalSnapshot({ pressureKpa: 65 });

    tickEnvironmentDamage(context.state, snapshot, 2);

    // 2 suit/min * 2 = 4, suit goes from 1 to 0
    expect(context.state.suitIntegrity).toBe(0);
    expect(context.state.hp).toBe(0);
    expect(context.state.gameOver).toBe(true);
    expect(context.state.metrics.deathCause).toBe('Suit failure — decompression');
  });

  it('[S] handles temperature extremes: suit damage at moderate, HP+suit at extreme', () => {
    // Hot but not extreme (38-44°C): suit only
    const { context: ctx1 } = createTestGameContext();
    const hot = tickEnvironmentDamage(ctx1.state, nominalSnapshot({ temperatureC: 40 }), 3);
    expect(hot.suitDamage).toBe(3);
    expect(hot.hpDamage).toBe(0);

    // Extreme hot (≥45°C): suit + HP
    const { context: ctx2 } = createTestGameContext();
    const extreme = tickEnvironmentDamage(ctx2.state, nominalSnapshot({ temperatureC: 50 }), 3);
    expect(extreme.suitDamage).toBe(3);
    expect(extreme.hpDamage).toBe(3);

    // Cold but not extreme (4-10°C): suit only
    const { context: ctx3 } = createTestGameContext();
    const cold = tickEnvironmentDamage(ctx3.state, nominalSnapshot({ temperatureC: 8 }), 3);
    expect(cold.suitDamage).toBe(3);
    expect(cold.hpDamage).toBe(0);

    // Extreme cold (≤4°C): suit + HP
    const { context: ctx4 } = createTestGameContext();
    const extremeCold = tickEnvironmentDamage(ctx4.state, nominalSnapshot({ temperatureC: 2 }), 3);
    expect(extremeCold.suitDamage).toBe(3);
    expect(extremeCold.hpDamage).toBe(3);
  });
});
