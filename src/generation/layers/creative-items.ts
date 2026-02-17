/**
 * Creative Sub-Layer: Item Content
 *
 * Generates names, descriptions, and use narrations for every item
 * in the station. Receives the identity seed for tone coherence.
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedSystemsItems } from './systems-items.js';
import type { ValidatedIdentitySeed } from './creative-identity.js';
import type { ItemCreative } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const ItemsCreativeSchema = z.object({
    items: z.array(z.object({
        itemId: z.string(),
        name: z.string(),
        description: z.string(),
        useNarration: z.string(),
    })),
});

type ItemsCreativeOutput = z.infer<typeof ItemsCreativeSchema>;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildItemsPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const identity = context['identitySeed'] as ValidatedIdentitySeed;

    const system = `You are a creative content generator for a sci-fi engineering survival adventure set on a derelict space station.

# Station Identity
- Name: ${identity.stationName}
- Tone: ${identity.toneKeywords.join(', ')}

# Rules

- Every itemId in your output MUST match an item ID from the data below
- Item names must be immersive and in-universe — name items as a space station engineer would label equipment
- description: 1-2 sentences describing the item's appearance and condition
- useNarration: 1 sentence describing what happens when the player uses the item`;

    const itemsSummary = systemsItems.items.map(i =>
        `  ${i.id} (${i.baseItemKey}) in ${i.roomId}${i.isKeyItem ? ' [KEY]' : ''}`,
    ).join('\n');

    let user = `Generate creative content for ALL ${String(systemsItems.items.length)} items:

${itemsSummary}`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateItemsCreative(output: ItemsCreativeOutput, context: LayerContext): ValidationResult<ItemCreative[]> {
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const errors: string[] = [];

    const itemIds = new Set(systemsItems.items.map(i => i.id));

    // Check for invalid itemIds
    for (const item of output.items) {
        if (!itemIds.has(item.itemId)) {
            errors.push(`Creative content references itemId '${item.itemId}' which does not exist. Valid IDs: [${[...itemIds].join(', ')}]`);
        }
    }

    // Coverage check
    const coveredItemIds = new Set(output.items.map(i => i.itemId));
    const missingItems = [...itemIds].filter(id => !coveredItemIds.has(id));
    if (missingItems.length > 0) {
        errors.push(`Missing creative content for items: [${missingItems.join(', ')}]`);
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    // Assemble validated item creative content with fallbacks
    const items: ItemCreative[] = systemsItems.items.map(skItem => {
        const creative = output.items.find(i => i.itemId === skItem.id);
        return {
            itemId: skItem.id,
            name: creative?.name ?? skItem.baseItemKey.replace(/_/g, ' '),
            description: creative?.description ?? skItem.baseItemKey.replace(/_/g, ' '),
            useNarration: creative?.useNarration ?? `You use the ${skItem.baseItemKey.replace(/_/g, ' ')}.`,
        };
    });

    return validationSuccess<ItemCreative[]>(items);
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const itemsCreativeLayer: LayerConfig<ItemsCreativeOutput, ItemCreative[]> = {
    name: 'Creative/Items',
    schema: ItemsCreativeSchema,
    buildPrompt: buildItemsPrompt,
    validate: validateItemsCreative,
    maxRetries: 2,
    timeoutMs: 90_000,
    maxOutputTokens: 4096,
    summarize: (v) => `${String(v.length)} items with creative content`,
};
