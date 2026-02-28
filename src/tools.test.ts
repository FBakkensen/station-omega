import { describe, expect, it, vi } from 'vitest';
import { createGameToolSets } from './tools.js';
import { createTestGameContext, parseJsonResult } from '../test/fixtures/factories.js';

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

  it('[O] look_around reveals room loot and returns sidebar-critical fields', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'look_around');

    expect(result.room_name).toBe('Docking Vestibule');
    expect(Array.isArray(result.items)).toBe(true);
    expect(context.state.revealedItems.has('item_wire')).toBe(true);
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
    const failureBeforeRepair = context.station.rooms.get('room_0')?.systemFailures.find(f => f.systemId === 'power_relay');
    if (!failureBeforeRepair) throw new Error('Expected power_relay failure fixture');
    const cascadeBeforeRepair = failureBeforeRepair.minutesUntilCascade;

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.79);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'repair_system', {
        system: 'power_relay',
        materials_used: ['item_wire'],
      });

      const failure = context.station.rooms.get('room_0')?.systemFailures.find(f => f.systemId === 'power_relay');
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

    const failure = context.station.rooms.get('room_0')?.systemFailures.find(f => f.systemId === 'power_relay');
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

  it('[E] blocks NPC trade interactions when target has no trade behavior', async () => {
    const { context } = createTestGameContext();
    const tools = createGameToolSets('engineer', context);
    const result = await runTool(tools.all as Record<string, unknown>, 'interact_npc', {
      approach: 'trade',
      target_npc: 'Ari Voss',
      leverage: 'Spare wire',
      tone: 'calm',
    });

    expect(result.error).toBe('Ari Voss has nothing to trade.');
  });

  it('[S] successful recruit interaction promotes an NPC to ally state', async () => {
    const { context } = createTestGameContext();
    const npc = context.station.npcs.get('npc_0');
    if (!npc) throw new Error('Expected npc_0 fixture');
    npc.behaviors.add('can_ally');

    const tools = createGameToolSets('engineer', context);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await runTool(tools.all as Record<string, unknown>, 'interact_npc', {
        approach: 'recruit',
        target_npc: 'npc_0',
        leverage: 'Mission-critical support',
        tone: 'empathetic',
      });

      expect(result.success).toBe(true);
      expect(result.is_ally).toBe(true);
      expect(npc.disposition).toBe('friendly');
      expect(context.state.npcAllies.has('npc_0')).toBe(true);
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
