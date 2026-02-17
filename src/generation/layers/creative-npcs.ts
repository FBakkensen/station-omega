/**
 * Creative Sub-Layer: NPC Content
 *
 * Generates names, appearance, personality, and sound signature
 * for every NPC in the station. Skipped when there are no NPCs.
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedObjectivesNPCs } from './objectives-npcs.js';
import type { ValidatedIdentitySeed } from './creative-identity.js';
import type { NPCCreative } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const NPCsCreativeSchema = z.object({
    npcCreative: z.array(z.object({
        npcId: z.string(),
        name: z.string(),
        appearance: z.string(),
        personality: z.string(),
        soundSignature: z.string(),
    })),
});

type NPCsCreativeOutput = z.infer<typeof NPCsCreativeSchema>;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildNPCsPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;
    const identity = context['identitySeed'] as ValidatedIdentitySeed;

    const system = `You are a creative content generator for a sci-fi engineering survival adventure set on a derelict space station.

# Station Identity
- Name: ${identity.stationName}
- Backstory: ${identity.backstory}
- Tone: ${identity.toneKeywords.join(', ')}

# Rules

- Every npcId in your output MUST match an NPC ID from the data below
- name: An in-universe character name
- appearance: 1-2 sentences describing what they look like
- personality: 1-2 sentences describing their personality and demeanor
- soundSignature: A brief description of their voice quality for TTS (e.g., "gravelly baritone", "nervous alto")`;

    const npcSummary = objectivesNPCs.npcs.map(n =>
        `  ${n.id} in ${n.roomId} — ${n.disposition} ${n.role}, behaviors: [${n.behaviors.join(', ')}]`,
    ).join('\n');

    let user = `Generate creative content for ALL ${String(objectivesNPCs.npcs.length)} NPCs:

${npcSummary}`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateNPCsCreative(output: NPCsCreativeOutput, context: LayerContext): ValidationResult<NPCCreative[]> {
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;
    const errors: string[] = [];

    const npcIds = new Set(objectivesNPCs.npcs.map(n => n.id));

    // Check for invalid npcIds
    for (const npc of output.npcCreative) {
        if (!npcIds.has(npc.npcId)) {
            errors.push(`Creative content references npcId '${npc.npcId}' which does not exist. Valid IDs: [${[...npcIds].join(', ')}]`);
        }
    }

    // Coverage check
    const coveredNpcIds = new Set(output.npcCreative.map(n => n.npcId));
    const missingNPCs = [...npcIds].filter(id => !coveredNpcIds.has(id));
    if (missingNPCs.length > 0) {
        errors.push(`Missing creative content for NPCs: [${missingNPCs.join(', ')}]`);
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    const npcCreative: NPCCreative[] = output.npcCreative
        .filter(n => npcIds.has(n.npcId))
        .map(n => ({
            npcId: n.npcId,
            name: n.name,
            appearance: n.appearance,
            personality: n.personality,
            soundSignature: n.soundSignature,
        }));

    return validationSuccess<NPCCreative[]>(npcCreative);
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const npcsCreativeLayer: LayerConfig<NPCsCreativeOutput, NPCCreative[]> = {
    name: 'Creative/NPCs',
    schema: NPCsCreativeSchema,
    buildPrompt: buildNPCsPrompt,
    validate: validateNPCsCreative,
    maxRetries: 2,
    timeoutMs: 60_000,
    maxOutputTokens: 2048,
    summarize: (v) => `${String(v.length)} NPCs with creative content`,
};
