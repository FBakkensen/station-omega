import { describe, expect, it } from 'vitest';
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
});
