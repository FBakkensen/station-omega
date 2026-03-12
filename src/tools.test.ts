import { describe, expect, it, vi } from 'vitest';
import { createGameToolSets } from './tools.js';
import { createTestGameContext, parseJsonResult } from '../test/fixtures/factories.js';
import type { SystemFailure } from './types.js';

type ExecutableTool = {
  execute: (args: Record<string, unknown>) => unknown;
};

async function runTool(
  allTools: Record<string, unknown>,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const tool = allTools[toolName] as ExecutableTool | undefined;
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  const raw = await Promise.resolve(tool.execute(args));
  return parseJsonResult(raw);
}

describe('createGameToolSets', () => {
  it('[Z] reports an error for unknown movement targets', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'move_to', {
      room: 'Nowhere Bay',
    });

    expect(result.error).toBe('Unknown room: "Nowhere Bay".');
  });

  it('[B] blocks move_to at the opening turn boundary before exploration', async () => {
    const { context } = createTestGameContext();
    context.isOpeningTurn = true;
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'move_to', {
      room: 'Cargo Hold',
    });

    expect(result.error).toBe('You just arrived. Explore the current room before moving.');
    expect(context.state.currentRoom).toBe('room_0');
  });

  it('[S] allows move_to after the opening turn', async () => {
    const { context } = createTestGameContext();
    context.isOpeningTurn = false;
    context.state.inventory.push('item_keycard');
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'move_to', {
      room: 'Escape Gantry',
    });

    expect(result.success).toBe(true);
    expect(context.state.currentRoom).toBe('room_1');
  });

  it('[O] look_around reveals room loot and returns sidebar-critical fields', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'look_around');

    expect(result.room_name).toBe('Docking Vestibule');
    expect(Array.isArray(result.items)).toBe(true);
    expect(context.state.revealedItems.has('item_wire')).toBe(true);
  });

  it('[I] suggest_actions preserves tactical choice metadata for the UI contract', async () => {
    const { context, capturedChoices } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    await runTool(tools.all as Record<string, unknown>, 'suggest_actions', {
      actions: [
        {
          label: 'Shunt the relay',
          description: 'Reroute power through the emergency bus.',
          risk: 'high',
          timeCost: '4 min',
          consequence: 'Stabilizes life support, but leaves coolant exposed.',
        },
      ],
    });

    expect(capturedChoices).toEqual([
      {
        title: 'Tactical Options',
        choices: [
          {
            label: 'Shunt the relay',
            description: 'Reroute power through the emergency bus.',
            risk: 'high',
            timeCost: '4 min',
            consequence: 'Stabilizes life support, but leaves coolant exposed.',
          },
        ],
      },
    ]);
  });

  it('[M] supports objective-complete escape movement to trigger victory', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_keycard');
    context.station.objectives.completed = true;
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'move_to', {
      room: 'Escape Gantry',
    });

    expect(result.success).toBe(true);
    expect(result.game_over).toBe(true);
    expect(context.state.won).toBe(true);
  });

  it('[M] mutation canary: blocks locked-room movement without required key item', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'move_to', {
      room: 'Escape Gantry',
    });

    expect(result.error).toBe('The door is locked. You need: Ops Keycard.');
    expect(context.state.currentRoom).toBe('room_0');
  });

  it('[B] enforces inventory capacity before pickup', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'look_around');
    context.state.inventory = Array.from({ length: context.state.maxInventory }, (_, i) => `full_${String(i)}`);

    const result = await runTool(tools.all as Record<string, unknown>, 'pick_up_item', {
      item: 'Insulated Wire',
    });

    expect(result.reason).toBe('inventory_full');
    expect(result.current).toBe(context.state.maxInventory);
  });

  it('[I] check_environment returns derived engineering diagnostics', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'check_environment');

    expect(result.atmosphere).toBeTypeOf('object');
    expect(result.derived).toBeTypeOf('object');
    const derived = result.derived as Record<string, unknown>;
    expect(derived['o2_partial_pressure_kpa']).toBeTypeOf('number');
  });

  it('[E] blocks repair attempts before diagnosis', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
      system: 'power_relay',
      materials_used: ['item_wire'],
    });

    expect(result.error).toBe('Diagnose the system first before attempting repair.');
  });

  it('[S] follows standard diagnose flow for an in-room failure', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'diagnose_system', {
      system: 'power_relay',
    });

    expect(result.success).toBe(true);
    expect(result.system_id).toBe('power_relay');
    expect(context.state.metrics.systemsDiagnosed).toBe(1);
  });

  it('[O] repairs a diagnosed system in one successful attempt, consuming required materials', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', {
      system: 'power_relay',
    });

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay',
        materials_used: ['item_wire'],
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('critical_success');
      expect(context.state.repairedSystems.has('power_relay:room_0')).toBe(true);
      expect(context.state.metrics.systemsRepaired).toBe(1);
      expect(context.state.inventory).toEqual(['multitool']);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('[B] partial repair stabilizes the failure and extends cascade time', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', {
      system: 'power_relay',
    });
    const failureBeforeRepair = context.station.rooms.get('room_0')?.systemFailures.find((f: SystemFailure) => f.systemId === 'power_relay');
    if (!failureBeforeRepair) throw new Error('Expected power_relay failure fixture');
    const cascadeBeforeRepair = failureBeforeRepair.minutesUntilCascade;

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.79);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay',
        materials_used: ['item_wire'],
      });

      const failure = context.station.rooms.get('room_0')?.systemFailures.find((f: SystemFailure) => f.systemId === 'power_relay');
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.outcome).toBe('partial_success');
      expect(failure?.challengeState).toBe('stabilized');
      // Intention: partial repairs buy additional time relative to just spending minutes.
      const actionMinutes = Number(result.action_minutes);
      const baselineWithoutStabilization = cascadeBeforeRepair - actionMinutes;
      expect(failure?.minutesUntilCascade).toBeGreaterThan(baselineWithoutStabilization);
      expect(failure?.minutesUntilCascade).toBeGreaterThan(0);
      expect(context.state.inventory).toEqual(['multitool']);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('[E] blocks objective completion when required system repair is not resolved', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'complete_objective', {
      step_description: 'Patched the relay panel.',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('system_not_repaired');
  });

  it('[M] advances objectives across many steps and marks mission complete', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    const failure = context.station.rooms.get('room_0')?.systemFailures.find((f: SystemFailure) => f.systemId === 'power_relay');
    if (!failure) throw new Error('Expected power_relay failure fixture in room_0');
    failure.challengeState = 'resolved';
    failure.status = 'repaired';

    const first = await runTool(tools.all as Record<string, unknown>, 'complete_objective', {
      step_description: 'Relay stabilized.',
    });
    expect(first.success).toBe(true);
    expect(first.all_complete).toBe(false);
    expect(first.next_room).toBe('Escape Gantry');

    context.state.currentRoom = 'room_1';
    context.state.inventory.push('item_keycard');

    const second = await runTool(tools.all as Record<string, unknown>, 'complete_objective', {
      step_description: 'Reached extraction point.',
    });
    expect(second.success).toBe(true);
    expect(second.all_complete).toBe(true);
    expect(context.station.objectives.completed).toBe(true);
    expect(context.station.objectives.currentStepIndex).toBe(2);
  });

  it('[Z] rejects objective completion when the player is in the wrong room', async () => {
    const { context } = createTestGameContext();
    context.state.currentRoom = 'room_1';
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'complete_objective', {
      step_description: 'Attempted objective from afar.',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('wrong_room');
  });

  it('[I] omits legacy NPC interaction tools from the toolset interface', () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    expect('interact_npc' in tools.all).toBe(false);
    expect('suggest_interactions' in tools.all).toBe(false);
  });

  it('[S] attempt_action accepts the command domain in the live tool schema', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'coordinate a controlled shutdown across nearby systems',
        domain: 'command',
        difficulty: 'moderate',
        relevant_items: [],
        environmental_factors: ['line of sight to relay indicators'],
      });

      expect(['success', 'critical_success']).toContain(result.outcome);
      expect(result.difficulty_used).toBe('moderate');
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('[B] engineer bypass requires a multitool in inventory', async () => {
    const { context } = createTestGameContext();
    context.state.inventory = [];
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'bypass_system', {
      target: 'Escape Gantry',
    });

    expect(result.error).toBe('You need a multitool for this.');
  });

  it('[S] engineer bypass can unlock one adjacent locked door', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'bypass_system', {
      target: 'escape',
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe('bypass_lock');
    expect(result.target_room).toBe('Escape Gantry');
    expect(context.station.rooms.get('room_1')?.lockedBy).toBeNull();
  });

  it('[O] medic field surgery heals once per room and blocks repeated use', async () => {
    const { context } = createTestGameContext('medic');
    context.state.hp = context.state.maxHp - 20;
    const tools = createGameToolSets('medic', context);

    const first = await runTool(tools.all as Record<string, unknown>, 'field_surgery');
    const second = await runTool(tools.all as Record<string, unknown>, 'field_surgery');

    expect(first.success).toBe(true);
    expect(first.healed).toBe(15);
    expect(context.state.hp).toBe(context.state.maxHp - 5);
    expect(context.state.metrics.totalDamageHealed).toBe(15);
    expect(second.error).toBe('You already performed field surgery in this room.');
  });

  it('[I] commander crisis assessment returns adjacent failure contract fields', async () => {
    const { context } = createTestGameContext('commander');
    const escapeRoom = context.station.rooms.get('room_1');
    if (!escapeRoom) throw new Error('Expected room_1 fixture');
    escapeRoom.systemFailures.push({
      systemId: 'coolant_loop',
      status: 'failing',
      failureMode: 'leak',
      severity: 2,
      challengeState: 'stabilized',
      requiredMaterials: ['coolant_canister'],
      requiredSkill: 'tech',
      difficulty: 'moderate',
      minutesUntilCascade: 42,
      cascadeTarget: null,
      hazardPerMinute: 0.2,
      diagnosisHint: 'Coolant pressure dropping in loop.',
      technicalDetail: 'Flow sensor reports intermittent cavitation.',
      mitigationPaths: ['replace valve'],
    });

    const tools = createGameToolSets('commander', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'crisis_assessment');

    const assessments = result.adjacent_assessments as Array<Record<string, unknown>>;
    expect(result.success).toBe(true);
    expect(Array.isArray(assessments)).toBe(true);
    expect(assessments).toHaveLength(1);
    expect(assessments[0]?.room_name).toBe('Escape Gantry');
    const failures = assessments[0]?.failures as Array<Record<string, unknown>>;
    if (failures.length !== 1) throw new Error('Expected one adjacent failure');
    const firstFailure = failures[0];
    expect(firstFailure.system_id).toBe('coolant_loop');
    expect(firstFailure.severity).toBe(2);
    expect(firstFailure.state).toBe('stabilized');
    expect(firstFailure.cascade_target).toBeNull();
    expect(typeof firstFailure.cascade_minutes).toBe('number');
    const cascadeMinutes = Number(firstFailure.cascade_minutes);
    expect(cascadeMinutes).toBeGreaterThan(0);
    expect(cascadeMinutes).toBeLessThan(42);
  });

  it('[Z] crafting with zero ingredients returns no known recipe', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'craft_item', {
      ingredients: [],
      intended_result: 'Anything useful',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_recipe');
  });

  it('[E] crafting rejects valid recipes when ingredients are missing', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);

    const result = await runTool(tools.all as Record<string, unknown>, 'craft_item', {
      ingredients: ['structural_epoxy', 'solvent'],
      intended_result: 'Improvised Sealant',
    });

    expect(result.error).toBe('Missing ingredients.');
    expect(result.missing).toEqual(['structural_epoxy', 'solvent']);
  });

  it('[S] successful crafting consumes ingredients and adds crafted output', async () => {
    const { context } = createTestGameContext();
    context.station.items.set('structural_epoxy', {
      id: 'structural_epoxy',
      name: 'Structural Epoxy',
      description: 'Vacuum-rated structural adhesive.',
      category: 'material',
      effect: { type: 'material', value: 1, description: 'Adhesive repair material.' },
      isKeyItem: false,
      useNarration: 'I smear epoxy over the fracture.',
    });
    context.station.items.set('solvent', {
      id: 'solvent',
      name: 'Industrial Solvent',
      description: 'Clears residue and dissolves corrosion.',
      category: 'chemical',
      effect: { type: 'chemical', value: 1, description: 'Chemical cleanup agent.' },
      isKeyItem: false,
      useNarration: 'I flush the line with solvent.',
    });
    context.state.inventory.push('structural_epoxy', 'solvent');

    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'craft_item', {
        ingredients: ['structural_epoxy', 'solvent'],
        intended_result: 'Improvised Sealant',
      });

      expect(result.success).toBe(true);
      expect(result.crafted).toBe('Improvised Sealant');
      expect(context.state.inventory).toContain('improvised_sealant');
      expect(context.state.inventory).not.toContain('structural_epoxy');
      expect(context.state.inventory).not.toContain('solvent');
      expect(context.state.metrics.itemsCrafted).toBe(1);
      expect(context.station.items.has('improvised_sealant')).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('difficulty clamping via attempt_action', () => {
  it('[Z] zero active failures — resolved failure does not raise difficulty floor', async () => {
    const { context } = createTestGameContext();
    const failure = context.station.rooms.get('room_0')?.systemFailures[0];
    if (!failure) throw new Error('Expected failure fixture');
    failure.challengeState = 'resolved';
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test zero-failure floor', domain: 'tech', difficulty: 'trivial',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('trivial');
      expect(result.difficulty_clamped).toBeUndefined();
    } finally { randomSpy.mockRestore(); }
  });

  it('[O] one active failure floors trivial difficulty to easy', async () => {
    const { context } = createTestGameContext();
    // room_0 has exactly one active failure by default (challengeState='detected')
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test single-failure floor', domain: 'tech', difficulty: 'trivial',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('easy');
      const clamped = result.difficulty_clamped as Record<string, unknown>;
      expect(clamped.from).toBe('trivial');
      expect(clamped.to).toBe('easy');
    } finally { randomSpy.mockRestore(); }
  });

  it('[M] multiple active failures floor trivial difficulty to moderate', async () => {
    const { context } = createTestGameContext();
    const room = context.station.rooms.get('room_0');
    if (!room) throw new Error('Expected room_0 fixture');
    room.systemFailures.push({
      systemId: 'coolant_loop', status: 'failing', failureMode: 'leak', severity: 1,
      challengeState: 'detected', requiredMaterials: [], requiredSkill: 'tech',
      difficulty: 'easy', minutesUntilCascade: 20, cascadeTarget: null,
      hazardPerMinute: 0.1, diagnosisHint: 'Coolant drip.', technicalDetail: 'Flow sensor cavitation.',
      mitigationPaths: ['replace valve'],
    });
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test multi-failure floor', domain: 'tech', difficulty: 'trivial',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('moderate');
    } finally { randomSpy.mockRestore(); }
  });

  it('[B] proficiency caps extreme difficulty at hard boundary', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test proficiency cap', domain: 'tech', difficulty: 'extreme',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('hard');
      const clamped = result.difficulty_clamped as Record<string, unknown>;
      expect(clamped.from).toBe('extreme');
      expect(clamped.to).toBe('hard');
    } finally { randomSpy.mockRestore(); }
  });

  it('[I] difficulty_clamped has from and to fields when difficulty is adjusted', async () => {
    const { context } = createTestGameContext();
    // 1 active failure floors trivial → easy (adjusted=true)
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test clamped field contract', domain: 'tech', difficulty: 'trivial',
        relevant_items: [], environmental_factors: [],
      });
      const clamped = result.difficulty_clamped as Record<string, string> | undefined;
      expect(typeof clamped).toBe('object');
      expect(typeof clamped?.from).toBe('string');
      expect(typeof clamped?.to).toBe('string');
    } finally { randomSpy.mockRestore(); }
  });

  it('[E] failed challenge state excludes failure from difficulty floor', async () => {
    const { context } = createTestGameContext();
    const failure = context.station.rooms.get('room_0')?.systemFailures[0];
    if (!failure) throw new Error('Expected failure fixture');
    failure.challengeState = 'failed';
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test failed exclusion', domain: 'medical', difficulty: 'trivial',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('trivial');
      expect(result.difficulty_clamped).toBeUndefined();
    } finally { randomSpy.mockRestore(); }
  });

  it('[S] standard moderate difficulty passes through unchanged', async () => {
    const { context } = createTestGameContext();
    // 1 active failure → floor=easy(1), tech proficiency → cap=hard(3), moderate(2) unchanged
    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'attempt_action', {
        action: 'test standard moderate', domain: 'tech', difficulty: 'moderate',
        relevant_items: [], environmental_factors: [],
      });
      expect(result.difficulty_used).toBe('moderate');
      expect(result.difficulty_clamped).toBeUndefined();
    } finally { randomSpy.mockRestore(); }
  });
});

describe('auto-complete objectives via tools', () => {
  it('[Z] no auto-complete when all objectives are already completed', async () => {
    const { context } = createTestGameContext();
    context.station.objectives.completed = true;
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      expect(result.objective_update).toBeUndefined();
    } finally { randomSpy.mockRestore(); }
  });

  it('[O] single successful repair auto-completes the current objective step', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      expect(result.success).toBe(true);
      expect(typeof result.objective_update).toBe('string');
      expect(result.objective_update as string).toContain('STEP COMPLETE');
    } finally { randomSpy.mockRestore(); }
  });

  it('[M] multi-step sequence: repair then move completes all objectives', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    // Complete step_0 via repair
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      // Add keycard and move to room_1 for step_1
      context.state.inventory.push('item_keycard');
      const moveResult = await runTool(tools.all as Record<string, unknown>, 'move_to', {
        room: 'Escape Gantry',
      });
      expect(typeof moveResult.objective_update).toBe('string');
      expect(moveResult.objective_update as string).toContain('OBJECTIVE COMPLETE');
    } finally { randomSpy.mockRestore(); }
  });

  it('[M] hidden future steps complete silently across many reveal-order transitions until the chain reaches them', async () => {
    const { context } = createTestGameContext();
    context.station.objectives.steps.splice(1, 0, {
      id: 'step_1b',
      description: 'Secure the Ops Keycard in Docking Vestibule.',
      roomId: 'room_0',
      requiredItemId: 'item_keycard',
      requiredSystemRepair: null,
      revealed: false,
      completed: false,
    });
    context.station.objectives.steps[2].id = 'step_2';
    context.station.objectives.steps[2].revealed = false;
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);

    await runTool(tools.all as Record<string, unknown>, 'look_around');
    const pickupResult = await runTool(tools.all as Record<string, unknown>, 'pick_up_item', {
      item: 'Ops Keycard',
    });

    expect(pickupResult.objective_update).toBeUndefined();
    expect(context.station.objectives.steps[1].completed).toBe(true);
    expect(context.station.objectives.steps[1].revealed).toBe(false);
    expect(context.station.objectives.currentStepIndex).toBe(0);

    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const repairResult = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });

      expect(repairResult.objective_update).toContain('Secure the Ops Keycard in Docking Vestibule.');
      expect(context.station.objectives.steps[1].revealed).toBe(true);
      expect(context.station.objectives.currentStepIndex).toBe(2);
    } finally { randomSpy.mockRestore(); }
  });

  it('[B] completing the final objective step sets won to true', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      context.state.inventory.push('item_keycard');
      await runTool(tools.all as Record<string, unknown>, 'move_to', { room: 'Escape Gantry' });
      expect(context.state.won).toBe(true);
    } finally { randomSpy.mockRestore(); }
  });

  it('[I] repair_system exposes structured objective progress alongside the summary string', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      expect(result).toHaveProperty('objective_update');
      expect(result).toHaveProperty('objective_progress');
      const progress = result.objective_progress as Record<string, unknown>;
      expect(progress.activeStep).toBeTypeOf('object');
    } finally { randomSpy.mockRestore(); }
  });

  it('[E] missing required item blocks objective step auto-completion on repair', async () => {
    const { context } = createTestGameContext();
    // Add item requirement to step_0 that player doesn't have
    context.station.objectives.steps[0].requiredItemId = 'item_keycard';
    // Engineer starts with only 'multitool', no keycard
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      expect(result.success).toBe(true);
      // No completion because required item missing
      expect(result.objective_update).toBeUndefined();
    } finally { randomSpy.mockRestore(); }
  });

  it('[S] complete_objective is a safe no-op after auto-completion fires', async () => {
    const { context } = createTestGameContext();
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    // First auto-complete via repair
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      // Step_0 is now completed; try manual complete_objective
      const result = await runTool(tools.all as Record<string, unknown>, 'complete_objective', {
        step_description: 'Manual completion after auto-complete.',
      });
      // Should not throw; result should be some valid response
      expect(result).toBeTypeOf('object');
    } finally { randomSpy.mockRestore(); }
  });

  it('[I] objective sync does not set state.won on the final non-escape step', async () => {
    const { context } = createTestGameContext();
    // Make step_0 the only step so objective sync marks the mission complete in place.
    context.station.objectives.steps = [context.station.objectives.steps[0]];
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      // Objective sync should mark objectives as completed...
      expect(context.station.objectives.completed).toBe(true);
      // ...but should NOT set state.won (only move_to escape room does that)
      expect(context.state.won).toBe(false);
    } finally { randomSpy.mockRestore(); }
  });
});

describe('moral choice detection via tools', () => {
  it('[Z] non-triggering tool calls do not record any moral choices', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'look_around');
    expect(context.state.moralProfile.choices.length).toBe(0);
  });

  it('[O] single record_moral_choice call records mercy with magnitude 2', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'mercy', magnitude: 2, description: 'Spared a hostile survivor cache by venting power instead of detonating it.',
    });
    expect(context.state.moralProfile.tendencies.mercy).toBe(2);
    expect(context.state.moralProfile.choices[0]?.tendency).toBe('mercy');
  });

  it('[M] multiple manual moral choice records accumulate across repeated calls', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'mercy', magnitude: 2, description: 'Preserved a damaged crew archive instead of scrapping it for parts.',
    });
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'mercy', magnitude: 1, description: 'Rerouted power to emergency lighting for old memorial plaques.',
    });
    expect(context.state.moralProfile.choices.length).toBe(2);
    expect(context.state.moralProfile.tendencies.mercy).toBe(3);
  });

  it('[B] repairing a non-objective system records sacrifice at exactly magnitude 1', async () => {
    const { context } = createTestGameContext();
    // Advance past step_0 so power_relay is no longer the objective system
    context.station.objectives.currentStepIndex = 1;
    context.station.objectives.steps[0].completed = true;
    context.state.inventory.push('item_wire');
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'diagnose_system', { system: 'power_relay' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay', materials_used: ['item_wire'],
      });
      expect(context.state.moralProfile.tendencies.sacrifice).toBe(1);
    } finally { randomSpy.mockRestore(); }
  });

  it('[I] moral choice record contains required turn, tendency, and description fields', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'pragmatic', magnitude: 1, description: 'Cut power to the secondary tram loop to preserve reactor stability.',
    });
    const choice = context.state.moralProfile.choices[0];
    expect(choice).toBeDefined();
    expect(typeof choice.turn).toBe('number');
    expect(typeof choice.tendency).toBe('string');
    expect(typeof choice.description).toBe('string');
    expect(typeof choice.magnitude).toBe('number');
  });

  it('[E] rejects invalid out-of-range manual moral choice magnitudes by clamping them safely', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'sacrifice', magnitude: 99, description: 'Stayed in the hot compartment to finish the repair.',
    });
    expect(context.state.moralProfile.choices[0]?.magnitude).toBe(3);
    expect(context.state.moralProfile.tendencies.sacrifice).toBe(3);
  });

  it('[S] standard manual record updates the intended tendency bucket', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    await runTool(tools.all as Record<string, unknown>, 'record_moral_choice', {
      tendency: 'mercy', magnitude: 1, description: 'Preserved a trapped log archive instead of scavenging it.',
    });
    expect(context.state.moralProfile.tendencies.mercy).toBe(1);
  });
});
