/**
 * Layer 4: Creative Content
 *
 * Generates names, descriptions, sensory details, crew logs,
 * arrival scenario, starting item, and NPC creative content
 * through parallel creative sub-layers.
 */

import { z } from 'zod';
import type { LayerContext } from '../layer-runner.js';
import { runLayer, LayerGenerationError } from '../layer-runner.js';
import { ConcurrencyLimiter } from '../concurrency.js';
import type { AIProviderOptions, AITextClient } from '../../io/ai-text-client.js';
import type { ValidatedTopology } from './topology.js';
import type { ValidatedObjectivesNPCs } from './objectives-npcs.js';
import type {
    CreativeContent,
    RoomCreative,
    ItemCreative,
    ArrivalScenario,
    StartingItemCreative,
    NPCCreative,
} from '../../types.js';
import { identitySeedLayer } from './creative-identity.js';
import { createSingleRoomLayer } from './creative-rooms.js';
import { itemsCreativeLayer } from './creative-items.js';
import { npcsCreativeLayer } from './creative-npcs.js';
import { arrivalCreativeLayer } from './creative-arrival.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const CreativeLayerSchema = z.object({
    stationName: z.string(),
    briefing: z.string(),
    backstory: z.string(),
    crewRoster: z.array(z.object({
        name: z.string(),
        role: z.string(),
        fate: z.string(),
    })),
    rooms: z.array(z.object({
        roomId: z.string(),
        name: z.string(),
        descriptionSeed: z.string(),
        engineeringNotes: z.string(),
        sensory: z.object({
            sounds: z.array(z.string().min(1)),
            smells: z.array(z.string().min(1)),
            visuals: z.array(z.string().min(1)),
            tactile: z.string().min(1),
        }),
        crewLogs: z.array(z.object({
            type: z.string(),
            author: z.string(),
            content: z.string(),
            condition: z.string(),
        })),
    })),
    items: z.array(z.object({
        itemId: z.string(),
        name: z.string(),
        description: z.string(),
        useNarration: z.string(),
    })),
    arrivalScenario: z.object({
        playerBackstory: z.string(),
        arrivalCondition: z.string(),
        knowledgeLevel: z.enum(['familiar', 'partial', 'none']),
        openingLine: z.string(),
        playerCallsign: z.string(),
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
    npcCreative: z.array(z.object({
        npcId: z.string(),
        name: z.string(),
        appearance: z.string(),
        personality: z.string(),
        soundSignature: z.string(),
    })).optional(),
});

export const VALID_LOG_TYPES = new Set([
    'datapad', 'wall_scrawl', 'audio_recording', 'terminal_entry',
    'engineering_report', 'calibration_record', 'failure_analysis',
]);

export function findCrewMatch(author: string, crewNames: Set<string>): string | null {
    if (crewNames.has(author)) return author;
    const lower = author.toLowerCase();
    for (const name of crewNames) {
        if (name.toLowerCase() === lower) return name;
    }
    for (const name of crewNames) {
        if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) return name;
    }
    return null;
}

// ─── Parallel Sub-Layer Orchestrator ─────────────────────────────────────────

/**
 * Runs creative content generation as parallel sub-layers:
 * 1. Identity seed (sequential) — station name, crew roster, tone
 * 2. Rooms + Items + NPCs + Arrival (parallel via Promise.allSettled)
 *
 * Only failed sub-layers retry, preserving successful results.
 */
export async function runCreativeSublayers(
    context: LayerContext,
    aiClient: AITextClient,
    modelId: string,
    onProgress?: (msg: string) => void,
    providerOptions?: AIProviderOptions,
    debugLog?: (label: string, content: string) => void,
): Promise<CreativeContent> {
    // ─── Phase 1: Identity Seed (sequential) ─────────────────────────────────
    onProgress?.('Crafting station identity...');
    debugLog?.('GENERATION', 'Starting Creative Phase 1: Identity Seed');

    const identity = await runLayer(
        identitySeedLayer,
        context,
        aiClient,
        modelId,
        onProgress,
        providerOptions,
        debugLog,
    );
    context['identitySeed'] = identity;
    debugLog?.('GENERATION', `Identity seed complete: "${identity.stationName}", crew: ${identity.crewRoster.map(c => c.name).join(', ')}`);

    // ─── Phase 2: Parallel Sub-Layers ────────────────────────────────────────
    const topology = context['topology'] as ValidatedTopology;
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;
    const hasNPCs = objectivesNPCs.npcs.length > 0;

    const maxConcurrent = 4;
    const limiter = new ConcurrencyLimiter(maxConcurrent);

    const roomCount = topology.rooms.length;
    const sublayerNames = [`${String(roomCount)} rooms`, 'items', ...(hasNPCs ? ['NPCs'] : []), 'arrival'];
    onProgress?.(`Generating ${sublayerNames.join(', ')}...`);
    debugLog?.('GENERATION', `Starting Creative Phase 2: ${sublayerNames.join(', ')} (max ${String(maxConcurrent)} concurrent)`);

    type SublayerResult = {
        label: string;
        promise: Promise<{ label: string; value: unknown }>;
    };

    // Per-room parallel calls — each room is an independent sub-layer, bounded by limiter
    const sublayers: SublayerResult[] = topology.rooms.map((room, i) => {
        const roomLayer = createSingleRoomLayer(room.id, i);
        return {
            label: `room:${room.id}`,
            promise: limiter.run(() =>
                runLayer(roomLayer, context, aiClient, modelId, undefined, providerOptions, debugLog),
            )
                .then(value => ({ label: `room:${room.id}`, value })),
        };
    });

    // Items, arrival, NPCs
    sublayers.push({
        label: 'items',
        promise: limiter.run(() =>
            runLayer(itemsCreativeLayer, context, aiClient, modelId, onProgress, providerOptions, debugLog),
        )
            .then(value => ({ label: 'items', value })),
    });
    sublayers.push({
        label: 'arrival',
        promise: limiter.run(() =>
            runLayer(arrivalCreativeLayer, context, aiClient, modelId, onProgress, providerOptions, debugLog),
        )
            .then(value => ({ label: 'arrival', value })),
    });

    if (hasNPCs) {
        sublayers.push({
            label: 'NPCs',
            promise: limiter.run(() =>
                runLayer(npcsCreativeLayer, context, aiClient, modelId, onProgress, providerOptions, debugLog),
            )
                .then(value => ({ label: 'NPCs', value })),
        });
    }

    const results = await Promise.allSettled(sublayers.map(s => s.promise));

    // Collect successes and failures
    const failures: string[] = [];
    const roomResults: RoomCreative[] = [];
    let items: ItemCreative[] | undefined;
    let npcCreative: NPCCreative[] | undefined;
    let arrival: { arrivalScenario: ArrivalScenario; startingItem: StartingItemCreative } | undefined;

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { label, value } = result.value;
            if (label.startsWith('room:')) roomResults.push(value as RoomCreative);
            else if (label === 'items') items = value as ItemCreative[];
            else if (label === 'NPCs') npcCreative = value as NPCCreative[];
            else if (label === 'arrival') arrival = value as { arrivalScenario: ArrivalScenario; startingItem: StartingItemCreative };
        } else {
            const err = result.reason instanceof LayerGenerationError
                ? result.reason.message
                : String(result.reason);
            failures.push(err);
        }
    }

    if (failures.length > 0) {
        const successCount = roomResults.length;
        const successLabels = [
            successCount > 0 ? `${String(successCount)}/${String(roomCount)} rooms` : null,
            items ? 'items' : null,
            npcCreative ? 'NPCs' : null,
            arrival ? 'arrival' : null,
        ].filter(Boolean);
        debugLog?.('GENERATION-FAIL', `Creative sub-layer failures (${String(failures.length)}):\n${failures.join('\n\n')}\nSuccessful: [${successLabels.join(', ')}]`);
        throw new LayerGenerationError('Creative (parallel)', failures.length, failures.map(f => [f]));
    }

    // All sub-layers succeeded — assemble CreativeContent
    if (!items || !arrival || roomResults.length !== roomCount) {
        throw new Error(`Creative sub-layer results incomplete: ${String(roomResults.length)}/${String(roomCount)} rooms, items=${String(!!items)}, arrival=${String(!!arrival)}`);
    }

    // Sort rooms back to topology order
    const roomOrderMap = new Map(topology.rooms.map((r, i) => [r.id, i]));
    roomResults.sort((a, b) => (roomOrderMap.get(a.roomId) ?? 0) - (roomOrderMap.get(b.roomId) ?? 0));

    onProgress?.('Finalizing station narrative...');
    debugLog?.('GENERATION', 'All creative sub-layers complete, assembling CreativeContent');

    const creative: CreativeContent = {
        stationName: identity.stationName,
        briefing: identity.briefing,
        backstory: identity.backstory,
        crewRoster: identity.crewRoster.map(c => ({
            name: c.name,
            role: c.role,
            fate: c.fate,
        })),
        rooms: roomResults,
        items,
        arrivalScenario: arrival.arrivalScenario,
        startingItem: arrival.startingItem,
        npcCreative: npcCreative && npcCreative.length > 0 ? npcCreative : undefined,
        visualStyleSeed: identity.visualStyleSeed,
        briefingVideoPrompt: identity.briefingVideoPrompt,
    };

    debugLog?.('GENERATION', `Creative assembly complete: "${creative.stationName}" — ${String(creative.rooms.length)} rooms, ${String(creative.items.length)} items, ${String(creative.npcCreative?.length ?? 0)} NPCs`);

    return creative;
}
