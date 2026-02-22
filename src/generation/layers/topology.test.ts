import { describe, expect, it } from 'vitest';
import type { LayerContext } from '../layer-runner.js';
import { topologyLayer } from './topology.js';
import { duplicateRoomId } from '../../../test/fixtures/mutations.js';

const baseContext: LayerContext = {
  difficulty: 'normal',
  characterClass: 'engineer',
};

type TopologyOutput = Parameters<typeof topologyLayer.validate>[0];

function buildValidTopologyOutput(): TopologyOutput {
  return {
    topology: 'branching_tree' as const,
    scenario: {
      theme: 'Cascade Relay Failure',
      centralTension: 'Power instabilities are propagating into life support.',
    },
    rooms: [
      { id: 'room_0', archetype: 'entry' as const, connections: ['room_1'], lockedBy: null },
      { id: 'room_1', archetype: 'utility' as const, connections: ['room_0', 'room_2'], lockedBy: null },
      { id: 'room_2', archetype: 'science' as const, connections: ['room_1', 'room_3'], lockedBy: null },
      { id: 'room_3', archetype: 'cargo' as const, connections: ['room_2', 'room_4'], lockedBy: null },
      { id: 'room_4', archetype: 'command' as const, connections: ['room_3', 'room_5'], lockedBy: 'keycard_0' },
      { id: 'room_5', archetype: 'medical' as const, connections: ['room_4', 'room_6'], lockedBy: null },
      { id: 'room_6', archetype: 'restricted' as const, connections: ['room_5', 'room_7'], lockedBy: null },
      { id: 'room_7', archetype: 'escape' as const, connections: ['room_6'], lockedBy: null },
    ],
    entryRoomId: 'room_0',
    escapeRoomId: 'room_7',
  };
}

function asSchemaValidTopologyOutput(raw: ReturnType<typeof buildValidTopologyOutput>) {
  return topologyLayer.schema.parse(raw);
}

describe('topologyLayer validation', () => {
  it('[Z] rejects an empty topology payload', () => {
    const raw = buildValidTopologyOutput();
    raw.topology = 'linear';
    raw.scenario = { theme: 'Empty', centralTension: 'None' };
    raw.rooms = [];
    raw.entryRoomId = 'room_0';
    raw.escapeRoomId = 'room_1';
    const output = asSchemaValidTopologyOutput(raw);
    const result = topologyLayer.validate(output, baseContext);
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('Room count');
  });

  it('[O] accepts a minimally valid normal-difficulty topology', () => {
    const result = topologyLayer.validate(asSchemaValidTopologyOutput(buildValidTopologyOutput()), baseContext);
    expect(result.success).toBe(true);
    expect(result.value?.rooms).toHaveLength(8);
  });

  it('[M] auto-repairs missing back-connections in larger outputs', () => {
    const output = buildValidTopologyOutput();
    const roomOne = output.rooms[1];
    roomOne.connections = ['room_2'];
    const result = topologyLayer.validate(asSchemaValidTopologyOutput(output), baseContext);
    expect(result.success).toBe(true);
    expect(result.repairs?.some((repair) => repair.includes('Added missing back-connection'))).toBe(true);
  });

  it('[B] enforces room count bounds for normal difficulty', () => {
    const output = buildValidTopologyOutput();
    output.rooms = output.rooms.slice(0, 7);
    output.escapeRoomId = 'room_6';
    const roomSix = output.rooms[6];
    roomSix.archetype = 'escape';
    const result = topologyLayer.validate(asSchemaValidTopologyOutput(output), baseContext);
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('allowed range');
  });

  it('[I] injects prior validation errors into retry prompts', () => {
    const prompt = topologyLayer.buildPrompt(baseContext, ['Duplicate room IDs']);
    expect(prompt.user).toContain('Fix ALL of them');
    expect(prompt.user).toContain('Duplicate room IDs');
    expect(prompt.system).toContain('Room Archetypes');
  });

  it('[E] rejects duplicate room IDs with explicit diagnostics', () => {
    const duplicated = duplicateRoomId(buildValidTopologyOutput(), 0, 2);
    const result = topologyLayer.validate(asSchemaValidTopologyOutput(duplicated), baseContext);
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('Duplicate room IDs');
  });

  it('[S] returns validated entry and escape room IDs for standard success', () => {
    const result = topologyLayer.validate(asSchemaValidTopologyOutput(buildValidTopologyOutput()), baseContext);
    expect(result.success).toBe(true);
    expect(result.value?.entryRoomId).toBe('room_0');
    expect(result.value?.escapeRoomId).toBe('room_7');
  });
});
