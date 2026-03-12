/**
 * Layer 4: Creative Content
 *
 * Generates names, descriptions, sensory details, crew logs,
 * arrival scenario, and starting item
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
} from '../../types.js';
import { identitySeedLayer } from './creative-identity.js';
import { createSingleRoomLayer } from './creative-rooms.js';
import type { RoomProseResult } from './creative-rooms.js';
import { roomMechanicalBatchLayer } from './creative-rooms-mechanical.js';
import { itemsCreativeLayer } from './creative-items.js';
import { arrivalCreativeLayer } from './creative-arrival.js';
import type { GenerationModelTiers } from '../../model-catalog.js';

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
});

export const VALID_LOG_TYPES = new Set([
    'datapad', 'wall_scrawl', 'audio_recording', 'terminal_entry',
    'engineering_report', 'calibration_record', 'failure_analysis',
]);

/** Fallback room name from archetype + room index (e.g., "Utility 1"). */
export function roomFallbackName(archetype: string, roomId: string): string {
    return `${archetype.charAt(0).toUpperCase()}${archetype.slice(1)} ${roomId.split('_')[1] ?? ''}`.trim();
}

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
 * 2a. Room mechanical batch (cheap model, single call) — names, sensory, notes
 * 2b. Room prose (N Opus calls) + Items + Arrival (parallel)
 * 3. Merge mechanical + prose into final RoomCreative[]
 *
 * Only failed sub-layers retry, preserving successful results.
 */
export async function runCreativeSublayers(
    context: LayerContext,
    aiClient: AITextClient,
    modelTiers: GenerationModelTiers,
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
        modelTiers.premium,
        onProgress,
        providerOptions,
        debugLog,
    );
    context['identitySeed'] = identity;
    debugLog?.('GENERATION', `Identity seed complete: "${identity.stationName}", crew: ${identity.crewRoster.map(c => c.name).join(', ')}`);

    // ─── Phase 2a: Room Mechanical Batch (cheap model, single call) ─────────
    const topology = context['topology'] as ValidatedTopology;
    const roomCount = topology.rooms.length;

    onProgress?.('Generating room details...');
    debugLog?.('GENERATION', 'Starting Creative Phase 2a: Room Mechanical Batch');

    const mechanicalResults = await runLayer(
        roomMechanicalBatchLayer,
        context,
        aiClient,
        modelTiers.cheap,
        undefined,
        providerOptions,
        debugLog,
    );

    // Store in context so prose layers can reference room names
    context['roomMechanical'] = mechanicalResults;

    debugLog?.('GENERATION', `Room mechanical batch complete: ${String(mechanicalResults.length)} rooms`);

    // ─── Phase 2b: Parallel Sub-Layers ───────────────────────────────────────
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;
    void objectivesNPCs;

    const maxConcurrent = 4;
    const limiter = new ConcurrencyLimiter(maxConcurrent);

    const sublayerNames = [`${String(roomCount)} room prose`, 'items', 'arrival'];
    onProgress?.(`Generating ${sublayerNames.join(', ')}...`);
    debugLog?.('GENERATION', `Starting Creative Phase 2b: ${sublayerNames.join(', ')} (max ${String(maxConcurrent)} concurrent)`);

    type SublayerResult = {
        label: string;
        promise: Promise<{ label: string; value: unknown }>;
    };

    // Per-room prose calls — each room is an independent sub-layer, bounded by limiter
    const sublayers: SublayerResult[] = topology.rooms.map((room, i) => {
        const roomLayer = createSingleRoomLayer(room.id, i);
        return {
            label: `room:${room.id}`,
            promise: limiter.run(() =>
                runLayer(roomLayer, context, aiClient, modelTiers.premium, undefined, providerOptions, debugLog),
            )
                .then(value => ({ label: `room:${room.id}`, value })),
        };
    });

    // Items and arrival
    sublayers.push({
        label: 'items',
        promise: limiter.run(() =>
            runLayer(itemsCreativeLayer, context, aiClient, modelTiers.mid, onProgress, providerOptions, debugLog),
        )
            .then(value => ({ label: 'items', value })),
    });
    sublayers.push({
        label: 'arrival',
        promise: limiter.run(() =>
            runLayer(arrivalCreativeLayer, context, aiClient, modelTiers.premium, onProgress, providerOptions, debugLog),
        )
            .then(value => ({ label: 'arrival', value })),
    });

    const results = await Promise.allSettled(sublayers.map(s => s.promise));

    // Collect successes and failures
    const failures: string[] = [];
    const roomProseResults: RoomProseResult[] = [];
    let items: ItemCreative[] | undefined;
    let arrival: { arrivalScenario: ArrivalScenario; startingItem: StartingItemCreative } | undefined;

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { label, value } = result.value;
            if (label.startsWith('room:')) roomProseResults.push(value as RoomProseResult);
            else if (label === 'items') items = value as ItemCreative[];
            else if (label === 'arrival') arrival = value as { arrivalScenario: ArrivalScenario; startingItem: StartingItemCreative };
        } else {
            const err = result.reason instanceof LayerGenerationError
                ? result.reason.message
                : String(result.reason);
            failures.push(err);
        }
    }

    if (failures.length > 0) {
        const successCount = roomProseResults.length;
        const successLabels = [
            successCount > 0 ? `${String(successCount)}/${String(roomCount)} room prose` : null,
            items ? 'items' : null,
            arrival ? 'arrival' : null,
        ].filter(Boolean);
        debugLog?.('GENERATION-FAIL', `Creative sub-layer failures (${String(failures.length)}):\n${failures.join('\n\n')}\nSuccessful: [${successLabels.join(', ')}]`);
        throw new LayerGenerationError('Creative (parallel)', failures.length, failures.map(f => [f]));
    }

    // All sub-layers succeeded — merge mechanical + prose into RoomCreative[]
    if (!items || !arrival || roomProseResults.length !== roomCount) {
        throw new Error(`Creative sub-layer results incomplete: ${String(roomProseResults.length)}/${String(roomCount)} rooms, items=${String(!!items)}, arrival=${String(!!arrival)}`);
    }

    // Build lookups for merge
    const mechanicalMap = new Map(mechanicalResults.map(m => [m.roomId, m]));
    const roomOrderMap = new Map(topology.rooms.map((r, i) => [r.id, i]));
    const topoRoomMap = new Map(topology.rooms.map(r => [r.id, r]));

    // Merge mechanical + prose into RoomCreative[]
    const mergedRooms: RoomCreative[] = roomProseResults.map(prose => {
        const mech = mechanicalMap.get(prose.roomId);
        const topoRoom = topoRoomMap.get(prose.roomId);
        const name = mech?.name ?? (topoRoom ? roomFallbackName(topoRoom.archetype, topoRoom.id) : prose.roomId);

        return {
            roomId: prose.roomId,
            name,
            descriptionSeed: prose.descriptionSeed,
            sensory: mech?.sensory ?? { sounds: [], smells: [], visuals: [], tactile: '' },
            crewLogs: prose.crewLogs,
            engineeringNotes: mech?.engineeringNotes ?? '',
        };
    });

    // Sort rooms back to topology order
    mergedRooms.sort((a, b) => (roomOrderMap.get(a.roomId) ?? 0) - (roomOrderMap.get(b.roomId) ?? 0));

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
        rooms: mergedRooms,
        items,
        arrivalScenario: arrival.arrivalScenario,
        startingItem: arrival.startingItem,
        visualStyleGuide: identity.visualStyleGuide,
        briefingVideoPrompt: identity.briefingVideoPrompt,
    };

    debugLog?.('GENERATION', `Creative assembly complete: "${creative.stationName}" — ${String(creative.rooms.length)} rooms, ${String(creative.items.length)} items`);

    return creative;
}
