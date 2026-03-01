import { describe, expect, it } from 'vitest';
import { buildTurnMessages, mapChoicesForPersistence, isValidSegmentType, shouldDowngradeDialogue } from './streamTurn.helpers';
import { EventTracker } from '../../src/events.js';
import { createTestState } from '../../test/fixtures/factories.js';

describe('streamTurn helper contracts', () => {
  it('[Z] builds a minimal user-only message when context/history are empty', () => {
    const messages = buildTurnMessages([], null, 'look around');
    expect(messages).toEqual([{ role: 'user', content: 'look around' }]);
  });

  it('[O] appends turn context before player input when provided', () => {
    const messages = buildTurnMessages([], 'status context', 'repair relay');
    expect(messages).toEqual([
      { role: 'system', content: 'status context' },
      { role: 'user', content: 'repair relay' },
    ]);
  });

  it('[M] preserves full conversation history ordering', () => {
    const messages = buildTurnMessages(
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'response' },
      ],
      'turn context',
      'next action',
    );
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'system', 'user']);
  });

  it('[B] treats empty-string context as absent context', () => {
    const messages = buildTurnMessages([], '', 'scan room');
    expect(messages).toEqual([{ role: 'user', content: 'scan room' }]);
  });

  it('[I] maps choices to persisted ID/label/description contract', () => {
    const mapped = mapChoicesForPersistence({
      title: 'Actions',
      choices: [
        { label: 'Inspect relay', description: 'Run diagnostics on the panel.' },
        { label: 'Stabilize coolant', description: 'Prevent thermal cascade.' },
      ],
    });

    expect(mapped).toEqual([
      { id: '0', label: 'Inspect relay', description: 'Run diagnostics on the panel.' },
      { id: '1', label: 'Stabilize coolant', description: 'Prevent thermal cascade.' },
    ]);
  });

  it('[E] safely handles empty choice sets', () => {
    expect(mapChoicesForPersistence({ title: 'none', choices: [] })).toEqual([]);
  });

  it('[S] produces deterministic IDs for standard choice arrays', () => {
    const first = mapChoicesForPersistence({
      title: 'Options',
      choices: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
    });
    const second = mapChoicesForPersistence({
      title: 'Options',
      choices: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
    });
    expect(first).toEqual(second);
  });
});

describe('segment validation helpers', () => {
  it('[Z] empty string type is not a valid segment type', () => {
    expect(isValidSegmentType('')).toBe(false);
  });

  it('[O] each of the six valid segment types returns true from isValidSegmentType', () => {
    const validTypes = ['narration', 'dialogue', 'thought', 'station_pa', 'crew_echo', 'diagnostic_readout'];
    for (const type of validTypes) {
      expect(isValidSegmentType(type)).toBe(true);
    }
  });

  it('[M] multiple social keywords all trigger social input detection', () => {
    const socialInputs = [
      'talk to the engineer',
      'speak with Ari',
      'ask about the relay',
      'negotiate a deal',
      'greet the survivor',
      'hello, anyone there?',
      'address the crew',
    ];
    for (const input of socialInputs) {
      // social inputs → shouldDowngrade = false (don't downgrade social dialogue)
      expect(shouldDowngradeDialogue('dialogue', input)).toBe(false);
    }
  });

  it('[B] social keyword at word boundary matches but partial word does not', () => {
    // 'ask' at word boundary matches (social input → no downgrade)
    expect(shouldDowngradeDialogue('dialogue', 'ask about the relay')).toBe(false);
    // 'task' contains 'ask' but not at word boundary — should NOT match social → should downgrade
    expect(shouldDowngradeDialogue('dialogue', 'complete the task')).toBe(true);
    // 'address' at boundary matches
    expect(shouldDowngradeDialogue('dialogue', 'address the crew')).toBe(false);
  });

  it('[I] shouldDowngradeDialogue returns boolean contract for dialogue vs narration types', () => {
    // dialogue on non-social turn → downgrade (true)
    expect(shouldDowngradeDialogue('dialogue', 'check the panel')).toBe(true);
    // dialogue on social turn → no downgrade (false)
    expect(shouldDowngradeDialogue('dialogue', 'talk to the engineer')).toBe(false);
    // narration on non-social turn → no downgrade (false) — only dialogue is downgraded
    expect(shouldDowngradeDialogue('narration', 'check the panel')).toBe(false);
    // narration on social turn → no downgrade (false)
    expect(shouldDowngradeDialogue('narration', 'talk to the engineer')).toBe(false);
  });

  it('[E] invalid or unknown segment type returns false from isValidSegmentType', () => {
    expect(isValidSegmentType('monologue')).toBe(false);
    expect(isValidSegmentType('scene_description')).toBe(false);
    expect(isValidSegmentType('NARRATION')).toBe(false); // case-sensitive check
  });

  it('[S] dialogue on social turn is not downgraded; narration is never downgraded', () => {
    // Standard happy path: dialogue + social → keep as dialogue (false = don't downgrade)
    expect(shouldDowngradeDialogue('dialogue', 'speak with Ari about the plan')).toBe(false);
    // narration never downgraded regardless of input
    expect(shouldDowngradeDialogue('narration', 'repair the relay')).toBe(false);
  });
});

describe('EventTracker tickActiveEvents damage application', () => {
  it('[O] applies HP damage proportional to elapsed minutes for hull_breach', () => {
    const state = createTestState();
    const initialHp = state.hp;
    state.activeEvents = [
      {
        type: 'hull_breach',
        description: 'Hull breach in sector 7',
        minutesRemaining: 30,
        effect: 'decompression',
        resolutionHint: 'Seal the breach',
      },
    ];

    const tracker = new EventTracker();
    const context = tracker.tickActiveEvents(state, 10);

    // hull_breach has damagePerMinute: 0.4 → Math.round(0.4 * 10) = 4 HP damage
    expect(state.hp).toBe(initialHp - 4);
    expect(state.metrics.totalDamageTaken).toBe(4);
    expect(context.length).toBeGreaterThan(0);
  });

  it('[M] applies zero damage when elapsed minutes is zero', () => {
    const state = createTestState();
    const initialHp = state.hp;
    state.activeEvents = [
      {
        type: 'hull_breach',
        description: 'Hull breach in sector 7',
        minutesRemaining: 30,
        effect: 'decompression',
        resolutionHint: 'Seal the breach',
      },
    ];

    const tracker = new EventTracker();
    tracker.tickActiveEvents(state, 0);

    expect(state.hp).toBe(initialHp);
  });

  it('[B] caps effective damage to event minutesRemaining when elapsed exceeds duration', () => {
    const state = createTestState();
    const initialHp = state.hp;
    state.activeEvents = [
      {
        type: 'hull_breach',
        description: 'Hull breach in sector 7',
        minutesRemaining: 5,
        effect: 'decompression',
        resolutionHint: 'Seal the breach',
      },
    ];

    const tracker = new EventTracker();
    tracker.tickActiveEvents(state, 100);

    // Only 5 minutes of damage: Math.round(0.4 * 5) = 2 HP
    expect(state.hp).toBe(initialHp - 2);
  });
});
