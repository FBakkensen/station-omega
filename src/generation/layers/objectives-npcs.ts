/**
 * Layer 3: Objectives
 *
 * Given validated topology + systems + items, the AI designs
 * the objective chain.
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
import type { SystemId } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const SystemIdEnum = z.enum([
    'life_support', 'pressure_seal', 'power_relay', 'coolant_loop',
    'atmosphere_processor', 'gravity_generator', 'radiation_shielding',
    'communications', 'fire_suppression', 'water_recycler',
    'thermal_regulator', 'structural_integrity',
]);

const ObjectivesNPCsSchema = z.object({
    objectives: z.object({
        title: z.string(),
        // Constraints (3-7 steps) enforced in validator, not schema,
        // because Anthropic's structured output rejects minItems > 1.
        steps: z.array(z.object({
            id: z.string(),
            description: z.string(),
            roomId: z.string(),
            requiredItemId: z.string().nullable(),
            requiredSystemRepair: SystemIdEnum.nullable(),
        })),
    }),
});

type ObjectivesNPCsOutput = z.infer<typeof ObjectivesNPCsSchema>;

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
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildObjectivesNPCsPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;

    const system = `You are a game designer creating the mission objectives for a space station survival game.

# Objective Design
- Create a compelling 3-7 step objective chain that guides the player through the station
- Each step has: id (like "step_0"), description, roomId, optional requiredItemId, optional requiredSystemRepair
- Steps should progress logically from entry toward escape as a strict ordered dependency chain
- Treat the array order as the reveal order: each step must feel unlocked by completing the previous one
- Each step must stand on its own when revealed later. Do not write descriptions that spoil future rooms, items, repairs, or twists before the player should know them
- It must still make sense if the player physically reaches a later room or satisfies a later condition early; the revealed text should read like the next discovered objective, not like a retrospective spoiler dump
- The LAST step MUST target the escape room (${topology.escapeRoomId})
- requiredItemId: reference an existing item ID from the items list, or null
- requiredSystemRepair: reference a system that has a failure in the target room, or null
- IMPORTANT: When a step requires BOTH a requiredItemId AND a requiredSystemRepair, the requiredItemId must be one of the materials needed for that system repair. The step description MUST mention ALL required materials for the repair (not just the objective item) so the player knows what to collect
- Step IDs must be unique (like "step_0", "step_1", etc.)
- Make descriptions action-oriented and specific to the scenario

# Rules
- Objective steps must reference rooms that exist in the topology
- If a step requires an item, that item ID must exist in the items list
- If a step requires a system repair, that system must have a failure in the specified room
- The objective chain should be completable given the station layout and available items
- Avoid "and then later" spoiler phrasing. Each description should read like the immediate next task, not a summary of the whole plan
- Make the objectives narratively connected to the scenario theme`;

    const roomsSummary = topology.rooms.map(r => {
        const failures = systemsItems.roomFailures.find(rf => rf.roomId === r.id);
        const failureStr = failures
            ? failures.failures.map(f => `${f.systemId}(${f.failureMode}, needs: ${f.requiredMaterials.join(', ')})`).join('; ')
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

Create a 3-7 step objective chain. Make the objective list an ordered dependency chain where each step becomes the natural next reveal after the previous one.`;

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

    // 5. Cross-check: when a step has both requiredItemId and requiredSystemRepair,
    //    verify the item's baseItemKey appears in the failure's requiredMaterials
    for (const step of output.objectives.steps) {
        if (step.requiredItemId && step.requiredSystemRepair && roomIdSet.has(step.roomId) && itemIdSet.has(step.requiredItemId)) {
            const item = systemsItems.items.find(i => i.id === step.requiredItemId);
            const roomFailures = systemsItems.roomFailures.find(rf => rf.roomId === step.roomId);
            const failure = roomFailures?.failures.find(f => f.systemId === step.requiredSystemRepair);
            if (item && failure && !failure.requiredMaterials.includes(item.baseItemKey)) {
                errors.push(`Objective step '${step.id}' requires item '${step.requiredItemId}' (${item.baseItemKey}) for repair of '${step.requiredSystemRepair}', but that system's requiredMaterials are [${failure.requiredMaterials.join(', ')}]. The objective item must be one of the repair materials`);
            }
        }
    }

    // 6. Last step must target escape room
    if (output.objectives.steps.length > 0) {
        const lastStep = output.objectives.steps[output.objectives.steps.length - 1];
        if (lastStep.roomId !== topology.escapeRoomId) {
            errors.push(`Last objective step must target the escape room (${topology.escapeRoomId}), got ${lastStep.roomId}`);
        }
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
    });
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const objectivesNPCsLayer: LayerConfig<ObjectivesNPCsOutput, ValidatedObjectivesNPCs> = {
    name: 'Objectives',
    schema: ObjectivesNPCsSchema,
    buildPrompt: buildObjectivesNPCsPrompt,
    validate: validateObjectivesNPCs,
    maxRetries: 3,
    summarize: (v) => `Objective: "${v.objectives.title}" — ${String(v.objectives.steps.length)} steps`,
};
