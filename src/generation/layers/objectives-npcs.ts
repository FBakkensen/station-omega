/**
 * Layer 3: Objectives & NPCs
 *
 * Given validated topology + systems + items, the AI designs
 * the objective chain and NPC placement.
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedTopology } from './topology.js';
import type { ValidatedSystemsItems } from './systems-items.js';
import type { SystemId, Disposition, NPCBehaviorFlag } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const SystemIdEnum = z.enum([
    'life_support', 'pressure_seal', 'power_relay', 'coolant_loop',
    'atmosphere_processor', 'gravity_generator', 'radiation_shielding',
    'communications', 'fire_suppression', 'water_recycler',
    'thermal_regulator', 'structural_integrity',
]);

const DispositionEnum = z.enum(['neutral', 'friendly', 'fearful']);

const NPCBehaviorFlagEnum = z.enum([
    'can_negotiate', 'can_ally', 'can_trade', 'is_intelligent',
]);

export const ObjectivesNPCsSchema = z.object({
    objectives: z.object({
        title: z.string(),
        // Constraints (3-7 steps, max 3 NPCs) enforced in validator, not schema,
        // because Anthropic's structured output rejects minItems > 1.
        steps: z.array(z.object({
            id: z.string(),
            description: z.string(),
            roomId: z.string(),
            requiredItemId: z.string().nullable(),
            requiredSystemRepair: SystemIdEnum.nullable(),
        })),
    }),
    npcs: z.array(z.object({
        id: z.string(),
        roomId: z.string(),
        disposition: DispositionEnum,
        behaviors: z.array(NPCBehaviorFlagEnum),
        role: z.string(),
    })),
});

export type ObjectivesNPCsOutput = z.infer<typeof ObjectivesNPCsSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface ValidatedObjectivesNPCs {
    objectives: {
        title: string;
        steps: Array<{
            id: string;
            description: string;
            roomId: string;
            requiredItemId: string | null;
            requiredSystemRepair: SystemId | null;
        }>;
    };
    npcs: Array<{
        id: string;
        roomId: string;
        disposition: Disposition;
        behaviors: NPCBehaviorFlag[];
        role: string;
    }>;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildObjectivesNPCsPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;

    const system = `You are a game designer creating the mission objectives and NPC encounters for a space station survival game.

# Objective Design
- Create a compelling 3-7 step objective chain that guides the player through the station
- Each step has: id (like "step_0"), description, roomId, optional requiredItemId, optional requiredSystemRepair
- Steps should progress logically from entry toward escape
- The LAST step MUST target the escape room (${topology.escapeRoomId})
- requiredItemId: reference an existing item ID from the items list, or null
- requiredSystemRepair: reference a system that has a failure in the target room, or null
- Step IDs must be unique (like "step_0", "step_1", etc.)
- Make descriptions action-oriented and specific to the scenario

# NPC Design (0-3 NPCs)
- NPCs are survivors, crew members, or other entities found on the station
- Each has: id (like "npc_0"), roomId (must exist), disposition (neutral/friendly/fearful), behaviors, role
- Dispositions: neutral (cautious), friendly (helpful), fearful (scared, may have useful info)
- Behaviors: can_negotiate, can_ally, can_trade, is_intelligent
- Role: brief description of who they are (e.g., "trapped engineer", "station medic", "security officer")
- Place NPCs in mid-station rooms, not in entry or escape rooms
- NPCs add social dynamics — a fearful survivor might need convincing, a trader might have needed materials

# Rules
- Objective steps must reference rooms that exist in the topology
- If a step requires an item, that item ID must exist in the items list
- If a step requires a system repair, that system must have a failure in the specified room
- The objective chain should be completable given the station layout and available items
- Make the objectives narratively connected to the scenario theme`;

    const roomsSummary = topology.rooms.map(r => {
        const failures = systemsItems.roomFailures.find(rf => rf.roomId === r.id);
        const failureStr = failures
            ? failures.failures.map(f => `${f.systemId}(${f.failureMode})`).join(', ')
            : 'none';
        return `  ${r.id} (${r.archetype}) — failures: [${failureStr}]`;
    }).join('\n');

    const itemsSummary = systemsItems.items.map(i =>
        `  ${i.id} in ${i.roomId} (${i.baseItemKey}${i.isKeyItem ? ', KEY' : ''})`,
    ).join('\n');

    let user = `Design objectives and NPCs for this station:

Scenario: ${topology.scenario.theme} — ${topology.scenario.centralTension}
Entry: ${topology.entryRoomId}
Escape: ${topology.escapeRoomId}
Character: ${context.characterClass}

Rooms and their failures:
${roomsSummary}

Items placed:
${itemsSummary}

Create a 3-7 step objective chain and 0-3 NPCs.`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateObjectivesNPCs(output: ObjectivesNPCsOutput, context: LayerContext): ValidationResult<ValidatedObjectivesNPCs> {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const errors: string[] = [];
    const roomIdSet = new Set(topology.rooms.map(r => r.id));
    const itemIdSet = new Set(systemsItems.items.map(i => i.id));

    // 0. Array length bounds (enforced here because Anthropic rejects minItems > 1 in schema)
    if (output.objectives.steps.length < 3) {
        errors.push(`Objective must have at least 3 steps, got ${String(output.objectives.steps.length)}`);
    }
    if (output.objectives.steps.length > 7) {
        errors.push(`Objective must have at most 7 steps, got ${String(output.objectives.steps.length)}`);
    }
    if (output.npcs.length > 3) {
        errors.push(`At most 3 NPCs allowed, got ${String(output.npcs.length)}`);
    }

    // 1. Step ID uniqueness
    const stepIds = output.objectives.steps.map(s => s.id);
    const stepIdSet = new Set(stepIds);
    if (stepIdSet.size !== stepIds.length) {
        const dupes = stepIds.filter((id, i) => stepIds.indexOf(id) !== i);
        errors.push(`Objective step IDs must be unique — ${[...new Set(dupes)].map(d => `'${d}'`).join(', ')} appear(s) multiple times`);
    }

    // 2. Step room existence
    for (const step of output.objectives.steps) {
        if (!roomIdSet.has(step.roomId)) {
            errors.push(`Objective step '${step.id}' references room '${step.roomId}' which does not exist. Valid rooms: [${[...roomIdSet].join(', ')}]`);
        }
    }

    // 3. Required item existence
    for (const step of output.objectives.steps) {
        if (step.requiredItemId && !itemIdSet.has(step.requiredItemId)) {
            errors.push(`Objective step '${step.id}' requires item '${step.requiredItemId}' but no item with that ID exists. Available items: [${[...itemIdSet].join(', ')}]`);
        }
    }

    // 4. Required system repair validity
    for (const step of output.objectives.steps) {
        if (step.requiredSystemRepair && roomIdSet.has(step.roomId)) {
            const roomFailures = systemsItems.roomFailures.find(rf => rf.roomId === step.roomId);
            const hasFailure = roomFailures?.failures.some(f => f.systemId === step.requiredSystemRepair);
            if (!hasFailure) {
                const available = roomFailures?.failures.map(f => f.systemId).join(', ') ?? 'none';
                errors.push(`Objective step '${step.id}' requires repair of '${step.requiredSystemRepair}' in ${step.roomId}, but that room has no such failure. Failures in ${step.roomId}: [${available}]`);
            }
        }
    }

    // 5. Last step must target escape room
    if (output.objectives.steps.length > 0) {
        const lastStep = output.objectives.steps[output.objectives.steps.length - 1];
        if (lastStep.roomId !== topology.escapeRoomId) {
            errors.push(`Last objective step must target the escape room (${topology.escapeRoomId}), got ${lastStep.roomId}`);
        }
    }

    // 6. NPC room validity
    for (const npc of output.npcs) {
        if (!roomIdSet.has(npc.roomId)) {
            errors.push(`NPC '${npc.id}' is placed in room '${npc.roomId}' which does not exist. Valid rooms: [${[...roomIdSet].join(', ')}]`);
        }
        if (npc.roomId === topology.entryRoomId) {
            errors.push(`NPC '${npc.id}' should not be placed in the entry room`);
        }
        if (npc.roomId === topology.escapeRoomId) {
            errors.push(`NPC '${npc.id}' should not be placed in the escape room`);
        }
    }

    // 7. NPC ID uniqueness
    const npcIds = output.npcs.map(n => n.id);
    const npcIdSet = new Set(npcIds);
    if (npcIdSet.size !== npcIds.length) {
        const dupes = npcIds.filter((id, i) => npcIds.indexOf(id) !== i);
        errors.push(`NPC IDs must be unique — ${[...new Set(dupes)].join(', ')} appear(s) multiple times`);
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    return validationSuccess<ValidatedObjectivesNPCs>({
        objectives: {
            title: output.objectives.title,
            steps: output.objectives.steps.map(s => ({
                id: s.id,
                description: s.description,
                roomId: s.roomId,
                requiredItemId: s.requiredItemId,
                requiredSystemRepair: s.requiredSystemRepair as SystemId | null,
            })),
        },
        npcs: output.npcs.map(n => ({
            id: n.id,
            roomId: n.roomId,
            disposition: n.disposition as Disposition,
            behaviors: n.behaviors as NPCBehaviorFlag[],
            role: n.role,
        })),
    });
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const objectivesNPCsLayer: LayerConfig<ObjectivesNPCsOutput, ValidatedObjectivesNPCs> = {
    name: 'Objectives & NPCs',
    schema: ObjectivesNPCsSchema,
    buildPrompt: buildObjectivesNPCsPrompt,
    validate: validateObjectivesNPCs,
    maxRetries: 3,
};
