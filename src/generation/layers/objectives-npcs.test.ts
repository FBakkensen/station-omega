import { describe, expect, it } from 'vitest';
import type { LayerContext } from '../layer-runner.js';
import type { ValidatedSystemsItems } from './systems-items.js';
import type { ValidatedTopology } from './topology.js';
import { objectivesNPCsLayer } from './objectives-npcs.js';
import {
  withInvalidObjectiveRoom,
  withInvalidRequiredItem,
} from '../../../test/fixtures/mutations.js';

const topology: ValidatedTopology = {
  topology: 'branching_tree',
  scenario: {
    theme: 'Containment Collapse',
    centralTension: 'Life support depends on restoring relay control.',
  },
  rooms: [
    { id: 'room_0', archetype: 'entry', connections: ['room_1'], lockedBy: null },
    { id: 'room_1', archetype: 'utility', connections: ['room_0', 'room_2'], lockedBy: null },
    { id: 'room_2', archetype: 'command', connections: ['room_1', 'room_3'], lockedBy: null },
    { id: 'room_3', archetype: 'escape', connections: ['room_2'], lockedBy: null },
  ],
  entryRoomId: 'room_0',
  escapeRoomId: 'room_3',
};

const systemsItems: ValidatedSystemsItems = {
  roomFailures: [
    {
      roomId: 'room_2',
      failures: [
        {
          systemId: 'power_relay',
          failureMode: 'overload',
          severity: 2,
          requiredMaterials: ['insulated_wire'],
          requiredSkill: 'tech',
          diagnosisHint: 'Relay panel is arcing.',
          mitigationPaths: ['replace relay', 'reroute power'],
          cascadeTarget: null,
          minutesUntilCascade: 18,
        },
      ],
    },
  ],
  items: [
    { id: 'item_wire', roomId: 'room_1', baseItemKey: 'insulated_wire', isKeyItem: false },
    { id: 'item_keycard', roomId: 'room_1', baseItemKey: 'keycard', isKeyItem: true },
  ],
};

const context: LayerContext = {
  difficulty: 'normal',
  characterClass: 'engineer',
  topology,
  systemsItems,
};

type ObjectivesOutput = Parameters<typeof objectivesNPCsLayer.validate>[0];

function buildValidOutput(): ObjectivesOutput {
  return {
    objectives: {
      title: 'Restore Escape Route',
      briefing: 'Life support depends on restoring relay control.',
      steps: [
        {
          id: 'step_0',
          description: 'Survey the utility corridor for recovery supplies.',
          roomId: 'room_1',
          requiredItemId: null,
          requiredSystemRepair: null,
        },
        {
          id: 'step_1',
          description:
            'Use insulated wire to repair the overloaded relay and restore command routing.',
          roomId: 'room_2',
          requiredItemId: 'item_wire',
          requiredSystemRepair: 'power_relay',
        },
        {
          id: 'step_2',
          description: 'Proceed to the escape bay once systems stabilize.',
          roomId: 'room_3',
          requiredItemId: 'item_keycard',
          requiredSystemRepair: null,
        },
      ],
    },
  };
}

function asSchemaValidObjectivesOutput(raw: ObjectivesOutput): ObjectivesOutput {
  return objectivesNPCsLayer.schema.parse(raw);
}

describe('objectivesNPCsLayer validation', () => {
  it('[Z] rejects objective chains with no steps', () => {
    const output = asSchemaValidObjectivesOutput({
      objectives: { title: 'Empty', briefing: '', steps: [] },
    });
    const result = objectivesNPCsLayer.validate(output, context);
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('at least 3 steps');
  });

  it('[O] accepts a valid 3-step objective chain', () => {
    const result = objectivesNPCsLayer.validate(asSchemaValidObjectivesOutput(buildValidOutput()), context);
    expect(result.success).toBe(true);
    expect(result.value?.objectives.steps).toHaveLength(3);
  });

  it('[M] allows complex output with material-linked repairs across multiple steps', () => {
    const output = buildValidOutput();
    output.objectives.steps.splice(2, 0, {
      id: 'step_1b',
      description: 'Stabilize the power routing through the command spine before opening the gantry.',
      roomId: 'room_2',
      requiredItemId: null,
      requiredSystemRepair: 'power_relay',
    });
    const result = objectivesNPCsLayer.validate(asSchemaValidObjectivesOutput(output), context);
    expect(result.success).toBe(true);
    expect(result.value?.objectives.steps).toHaveLength(4);
  });

  it('[B] accepts the minimum boundary of exactly three ordered objective steps', () => {
    const output = buildValidOutput();
    const result = objectivesNPCsLayer.validate(asSchemaValidObjectivesOutput(output), context);
    expect(result.success).toBe(true);
    expect(result.value?.objectives.steps).toHaveLength(3);
  });

  it('[I] includes station context and retry guidance in prompt construction', () => {
    const prompt = objectivesNPCsLayer.buildPrompt(context, ['Room mismatch in step_1']);
    expect(prompt.system).toContain('Objective Design');
    expect(prompt.system).toContain('strict ordered dependency chain');
    expect(prompt.system).toContain('Do not write descriptions that spoil future rooms');
    expect(prompt.system).toContain('NEVER use raw IDs');
    expect(prompt.system).toContain('frame the problem or situation, NEVER the solution');
    expect(prompt.system).toContain('briefing');
    expect(prompt.user).toContain('Fix ALL of them');
    expect(prompt.user).toContain('Room mismatch in step_1');
    expect(prompt.user).toContain('Entry: room_0');
    expect(prompt.user).toContain('ordered dependency chain');
    expect(prompt.user).toContain('needs: insulated_wire');
  });

  it('[E] reports invalid room and required item references', () => {
    const invalidRoom = withInvalidObjectiveRoom(buildValidOutput(), 1, 'room_99');
    const invalidItem = withInvalidRequiredItem(invalidRoom, 1, 'item_missing');
    const result = objectivesNPCsLayer.validate(asSchemaValidObjectivesOutput(invalidItem), context);
    expect(result.success).toBe(false);
    const errors = result.errors?.join(' ') ?? '';
    expect(errors).toContain('does not exist');
    expect(errors).toContain('item_missing');
  });

  it('[S] ensures the final step targets the escape room', () => {
    const output = buildValidOutput();
    const finalStep = output.objectives.steps[2];
    finalStep.roomId = 'room_2';
    const result = objectivesNPCsLayer.validate(asSchemaValidObjectivesOutput(output), context);
    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('Last objective step must target the escape room');
  });
});
