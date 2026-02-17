/**
 * Creative Sub-Layer: Arrival Scenario & Starting Item
 *
 * Generates the player's arrival backstory and the starting item
 * they find in the entry room. Validates that the starting item ID
 * does not collide with any existing skeleton item.
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
import type { ValidatedIdentitySeed } from './creative-identity.js';
import type { ArrivalScenario, StartingItemCreative } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ArrivalCreativeSchema = z.object({
    arrivalScenario: z.object({
        playerBackstory: z.string(),
        arrivalCondition: z.string(),
        knowledgeLevel: z.enum(['familiar', 'partial', 'none']),
        openingLine: z.string(),
    }),
    startingItem: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.enum(['medical', 'tool', 'material']),
        effectType: z.enum(['heal', 'tool', 'material']),
        effectValue: z.number(),
        useNarration: z.string(),
    }),
});

export type ArrivalCreativeOutput = z.infer<typeof ArrivalCreativeSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface ValidatedArrival {
    arrivalScenario: ArrivalScenario;
    startingItem: StartingItemCreative;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildArrivalPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const identity = context['identitySeed'] as ValidatedIdentitySeed;

    const entryRoom = topology.rooms.find(r => r.id === topology.entryRoomId);
    const entryFailures = systemsItems.roomFailures.find(rf => rf.roomId === topology.entryRoomId);
    const failureStr = entryFailures
        ? entryFailures.failures.map(f => `${f.systemId}(${f.failureMode}, sev${String(f.severity)})`).join(', ')
        : 'none';

    const existingItemIds = systemsItems.items.map(i => i.id);

    const system = `You are a creative writer generating the arrival scenario and starting item for a sci-fi engineering survival adventure.

# Station Identity
- Name: ${identity.stationName}
- Briefing: ${identity.briefing}
- Backstory: ${identity.backstory}
- Tone: ${identity.toneKeywords.join(', ')}

# Arrival Scenario Rules

- playerBackstory: 2-3 sentences explaining why the player is here
- arrivalCondition: 1 sentence describing physical/mental state
- knowledgeLevel: "familiar", "partial", or "none"
- openingLine: First-person, visceral, sensory

# Starting Item Rules

An item the player finds immediately in the starting room. Must fit the scenario:
- Medical items: category "medical", effectType "heal", effectValue 15-40
- Tools: category "tool", effectType "tool", effectValue 1
- Materials: category "material", effectType "material", effectValue 1
- CRITICAL: startingItem.id must be UNIQUE — it must NOT match any of these existing item IDs: [${existingItemIds.join(', ')}]
- Use a descriptive ID like "starting_medkit" or "emergency_toolkit"`;

    let user = `Generate arrival scenario and starting item:

Character: ${context.characterClass}
Difficulty: ${context.difficulty}
Entry room: ${topology.entryRoomId} (${entryRoom?.archetype ?? 'unknown'}) — failures: [${failureStr}]`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateArrivalCreative(output: ArrivalCreativeOutput, context: LayerContext): ValidationResult<ValidatedArrival> {
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const errors: string[] = [];

    const itemIds = new Set(systemsItems.items.map(i => i.id));

    // Starting item ID must not collide with any Layer 2 item ID
    if (itemIds.has(output.startingItem.id)) {
        errors.push(`startingItem.id '${output.startingItem.id}' collides with an existing item. Choose a unique ID that is NOT in: [${[...itemIds].join(', ')}]`);
    }

    // Validate effectValue ranges
    if (output.startingItem.effectType === 'heal') {
        if (output.startingItem.effectValue < 15 || output.startingItem.effectValue > 40) {
            errors.push(`Medical startingItem effectValue ${String(output.startingItem.effectValue)} is out of range — must be 15-40`);
        }
    } else {
        if (output.startingItem.effectValue !== 1) {
            errors.push(`${output.startingItem.effectType} startingItem effectValue must be 1, got ${String(output.startingItem.effectValue)}`);
        }
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    return validationSuccess<ValidatedArrival>({
        arrivalScenario: {
            playerBackstory: output.arrivalScenario.playerBackstory,
            arrivalCondition: output.arrivalScenario.arrivalCondition,
            knowledgeLevel: output.arrivalScenario.knowledgeLevel,
            openingLine: output.arrivalScenario.openingLine,
        },
        startingItem: {
            id: output.startingItem.id,
            name: output.startingItem.name,
            description: output.startingItem.description,
            category: output.startingItem.category,
            effectType: output.startingItem.effectType,
            effectValue: output.startingItem.effectValue,
            useNarration: output.startingItem.useNarration,
        },
    });
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const arrivalCreativeLayer: LayerConfig<ArrivalCreativeOutput, ValidatedArrival> = {
    name: 'Creative/Arrival',
    schema: ArrivalCreativeSchema,
    buildPrompt: buildArrivalPrompt,
    validate: validateArrivalCreative,
    maxRetries: 2,
    timeoutMs: 90_000,
    maxOutputTokens: 2048,
    summarize: (v) => [
        `Knowledge: ${v.arrivalScenario.knowledgeLevel}`,
        `Starting item: ${v.startingItem.name} (${v.startingItem.category})`,
    ].join('\n'),
};
