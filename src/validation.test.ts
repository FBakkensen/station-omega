import { describe, expect, it } from 'vitest';
import { createTestState, createTestStation } from '../test/fixtures/factories.js';
import type { GameResponse } from './schema.js';
import {
  buildGuardrailFeedback,
  validateGameResponse,
  validateStateConsistency,
} from './validation.js';

function cloneFixtureState() {
  return createTestState();
}

function cloneFixtureStation() {
  return createTestStation();
}

describe('validation helpers', () => {
  it('[Z] returns zero guardrail issues when zero response segments are provided', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    const response: GameResponse = { segments: [] };

    const issues = validateGameResponse(response, state, station);

    expect(issues).toEqual([]);
  });

  it('[O] accepts one valid in-room dialogue reference to a known NPC id', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    const response: GameResponse = {
      segments: [
        {
          type: 'dialogue',
          text: 'We can stabilize the relay together.',
          npcId: 'npc_0',
          crewName: null,
        },
      ],
    };

    const issues = validateGameResponse(response, state, station);

    expect(issues).toEqual([]);
  });

  it('[M] builds multi-section guardrail feedback with issue bullets, roster, failures, and ground-truth state', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    state.hp = 92;
    state.oxygen = 81;
    state.suitIntegrity = 88;
    state.inventory.push('item_keycard');

    const feedback = buildGuardrailFeedback(
      ['Unknown NPC ID: npc_404', 'Unknown crew name: Ghost'],
      state,
      station,
      [
        { tool: 'repair_system', summary: 'missing required materials' },
        { tool: 'move_to', summary: 'door remained locked' },
      ],
    );

    expect(feedback).toContain('PREVIOUS RESPONSE REJECTED');
    expect(feedback).toContain('Unknown NPC ID: npc_404');
    expect(feedback).toContain('Valid crew roster names');
    expect(feedback).toContain('Tool calls that FAILED this turn');
    expect(feedback).toContain('GROUND TRUTH — current game state');
    expect(feedback).toContain('Current room');
  });

  it('[B] clamps boundary-violating vitals to stable min/max limits', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    state.hp = 999;
    state.oxygen = -50;
    state.suitIntegrity = 140;

    const issues = validateStateConsistency(state, station);

    expect(state.hp).toBe(state.maxHp);
    expect(state.oxygen).toBe(0);
    expect(state.suitIntegrity).toBe(100);
    expect(issues.some((issue) => issue.field === 'hp' && issue.fixed)).toBe(true);
    expect(issues.some((issue) => issue.field === 'oxygen' && issue.fixed)).toBe(true);
    expect(issues.some((issue) => issue.field === 'suitIntegrity' && issue.fixed)).toBe(true);
  });

  it('[I] preserves issue interface contract fields for structural consistency diagnostics', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    state.currentRoom = 'missing_room';

    const issues = validateStateConsistency(state, station);
    const roomIssue = issues.find((issue) => issue.field === 'currentRoom');

    expect(roomIssue).toBeDefined();
    if (!roomIssue) throw new Error('missing room issue fixture');
    expect(typeof roomIssue.field).toBe('string');
    expect(typeof roomIssue.problem).toBe('string');
    expect(typeof roomIssue.fixed).toBe('boolean');
  });

  it('[E] removes invalid phantom inventory entries and reports missing-room errors safely', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    state.currentRoom = 'ghost_room';
    state.inventory.push('missing_item_1', 'missing_item_2');

    const issues = validateStateConsistency(state, station);

    expect(state.inventory).not.toContain('missing_item_1');
    expect(state.inventory).not.toContain('missing_item_2');
    expect(issues.some((issue) => issue.field === 'inventory' && issue.fixed)).toBe(true);
    expect(issues.some((issue) => issue.field === 'currentRoom' && !issue.fixed)).toBe(true);
  });

  it('[S] follows standard validation flow by leaving already-valid state unchanged', () => {
    const station = cloneFixtureStation();
    const state = cloneFixtureState();
    state.inventory = [];
    const baseline = {
      hp: state.hp,
      oxygen: state.oxygen,
      suitIntegrity: state.suitIntegrity,
      inventory: [...state.inventory],
      currentRoom: state.currentRoom,
    };

    const issues = validateStateConsistency(state, station);

    expect(issues).toEqual([]);
    expect(state.hp).toBe(baseline.hp);
    expect(state.oxygen).toBe(baseline.oxygen);
    expect(state.suitIntegrity).toBe(baseline.suitIntegrity);
    expect(state.inventory).toEqual(baseline.inventory);
    expect(state.currentRoom).toBe(baseline.currentRoom);
  });
});
