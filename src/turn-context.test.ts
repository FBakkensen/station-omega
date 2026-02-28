import { describe, expect, it } from 'vitest';
import type { ActiveEvent } from './types.js';
import { buildTurnContext } from './turn-context.js';
import { createTestGameContext } from '../test/fixtures/factories.js';

function makeEvent(overrides: Partial<ActiveEvent> = {}): ActiveEvent {
  return {
    type: 'power_failure',
    description: 'Main bus dropped offline.',
    minutesRemaining: 12,
    effect: 'station power grid offline — visibility severely limited, instruments dark',
    resolutionHint: 'Backup capacitor bank reached sufficient charge to restart main bus',
    ...overrides,
  };
}

function expectContext(value: string | null): string {
  if (value === null) throw new Error('Expected non-null turn context');
  return value;
}

describe('buildTurnContext', () => {
  it('[Z] returns baseline context for zero modifiers in a nominal room', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.missionElapsedMinutes = 0;

    const built = expectContext(buildTurnContext(context.state, context.station));

    expect(built).toContain('MISSION ELAPSED TIME: T+00:00');
    expect(built).toContain('ENVIRONMENT:');
    expect(built).not.toContain('## Active Station Events');
    expect(built).not.toContain('ALLY:');
    expect(built).not.toContain('MORAL PROFILE:');
    expect(built).not.toContain('PLAYER CONDITION:');
    expect(built).not.toContain('OXYGEN:');
    expect(built).not.toContain('SUIT INTEGRITY:');
    expect(built).not.toContain('SYSTEM FAILURES:');
  });

  it('[O] adds one active event section when a single event is present', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.activeEvents = [makeEvent()];

    const built = expectContext(buildTurnContext(context.state, context.station));

    expect(built).toContain('## Active Station Events');
    expect(built).toContain('POWER FAILURE');
    expect(built).toContain('(12 min remaining)');
  });

  it('[M] includes many context signals across events, allies, and degraded status', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_0';
    context.state.activeEvents = [
      makeEvent(),
      makeEvent({
        type: 'radiation_spike',
        minutesRemaining: 7,
        effect: 'radiation exposure — continuous HP and suit degradation',
      }),
    ];
    context.state.moralProfile.tendencies = {
      mercy: 2,
      sacrifice: 1,
      pragmatic: 0,
    };
    context.state.hp = 40;
    context.state.oxygen = 82;
    context.state.suitIntegrity = 91;

    const primaryNpc = context.station.npcs.get('npc_0');
    if (!primaryNpc) throw new Error('Expected npc_0 fixture');
    primaryNpc.isAlly = true;
    context.station.npcs.set('npc_1', {
      ...primaryNpc,
      id: 'npc_1',
      name: 'Len Marr',
      behaviors: new Set(primaryNpc.behaviors),
      memory: {
        playerActions: [],
        dispositionHistory: [],
        wasSpared: false,
        wasHelped: false,
        tradeInventory: [],
      },
    });

    const built = expectContext(buildTurnContext(context.state, context.station));

    expect(built).toContain('ALLY: Ari Voss is helping you.');
    expect(built).toContain('ALLY: Len Marr is helping you.');
    expect(built).toContain('MORAL PROFILE: mercy=2, sacrifice=1, pragmatic=0');
    expect(built).toContain('PLAYER CONDITION: HP 40/100 (40%)');
    expect(built).toContain('OXYGEN: 82/100');
    expect(built).toContain('SUIT INTEGRITY: 91%');
    expect(built).toContain('SYSTEM FAILURES:');
    expect(built).toContain('POWER FAILURE');
    expect(built).toContain('RADIATION SPIKE');
  });

  it('[B] keeps player-condition boundary behavior stable at exactly 50% HP', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.hp = 50;

    const atBoundary = expectContext(buildTurnContext(context.state, context.station));
    context.state.hp = 49;
    const belowBoundary = expectContext(buildTurnContext(context.state, context.station));

    expect(atBoundary).not.toContain('PLAYER CONDITION:');
    expect(belowBoundary).toContain('PLAYER CONDITION: HP 49/100 (49%)');
  });

  it('[I] preserves environment readout interface labels in the context contract', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';

    const built = expectContext(buildTurnContext(context.state, context.station));
    const section = built.split('\n\n').find((part) => part.startsWith('ENVIRONMENT:'));

    if (!section) throw new Error('Expected ENVIRONMENT section');
    expect(section).toMatch(/ENVIRONMENT: .*Pressure .*Temp .*Rad .*Structural/);
  });

  it('[E] handles invalid current-room references without throwing context build errors', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_missing';

    expect(() => buildTurnContext(context.state, context.station)).not.toThrow();
    const built = expectContext(buildTurnContext(context.state, context.station));
    expect(built).toContain('MISSION ELAPSED TIME:');
    expect(built).not.toContain('ENVIRONMENT:');
    expect(built).not.toContain('SYSTEM FAILURES:');
  });

  it('[S] formats standard mission elapsed time with zero-padded hours and minutes', () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    context.state.missionElapsedMinutes = 125;

    const built = expectContext(buildTurnContext(context.state, context.station));

    expect(built).toContain('MISSION ELAPSED TIME: T+02:05');
    expect(built).toContain('ENVIRONMENT:');
  });
});
