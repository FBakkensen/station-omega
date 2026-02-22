/**
 * Station Generation Orchestrator
 *
 * Runs the station generation pipeline and passes validated output
 * forward. Layer 2 (systems/items) is deterministic; the creative
 * phase runs parallel sub-layers. Produces a
 * StationSkeleton + CreativeContent pair ready for assembly.
 */

import type {
    StationSkeleton,
    CreativeContent,
    RoomSkeleton,
    ItemSkeleton,
    ObjectiveChain,
    SystemFailureSkeleton,
    Difficulty,
    CharacterClassId,
    ActionDifficulty,
} from '../types.js';
import { ENGINEERING_ITEMS } from '../data.js';
import { computeDepths } from '../graph.js';
import { runLayer } from './layer-runner.js';
import type { LayerContext } from './layer-runner.js';
import type { AIProviderOptions, AITextClient } from '../io/ai-text-client.js';
import { createGenerationLogger } from '../generation-log.js';
import { topologyLayer } from './layers/topology.js';
import { generateSystemsItemsProcedural } from './layers/systems-items-procedural.js';
import { objectivesNPCsLayer } from './layers/objectives-npcs.js';
import { runCreativeSublayers } from './layers/creative.js';

interface GenerationConfig {
    difficulty: Difficulty;
    characterClass: CharacterClassId;
    aiClient: AITextClient;
    modelId: string;
    providerOptions?: AIProviderOptions;
}

function difficultyForSeverity(severity: 1 | 2 | 3): ActionDifficulty {
    if (severity === 1) return 'easy';
    if (severity === 2) return 'moderate';
    return 'hard';
}

export async function generateStation(
    config: GenerationConfig,
    onProgress?: (msg: string) => void,
    debugLog?: (label: string, content: string) => void,
): Promise<{ skeleton: StationSkeleton; creative: CreativeContent }> {
    const context: LayerContext = {
        difficulty: config.difficulty,
        characterClass: config.characterClass,
    };

    // Combined logger: writes to both the per-station log file and the external debugLog callback
    const logger = createGenerationLogger(config.difficulty, config.characterClass);
    const combinedLog = (label: string, content: string): void => {
        logger.log(label, content);
        debugLog?.(label, content);
    };

    // ─── Layer 1: Topology ───────────────────────────────────────────────────
    onProgress?.('Designing station layout...');
    combinedLog('GENERATION', 'Starting Layer 1: Topology');

    const po = config.providerOptions;

    const topology = await runLayer(
        topologyLayer,
        context,
        config.aiClient,
        config.modelId,
        onProgress,
        po,
        combinedLog,
    );
    context['topology'] = topology;
    combinedLog('GENERATION', `Layer 1 complete: ${String(topology.rooms.length)} rooms, ${topology.topology} topology`);

    // ─── Layer 2: Systems & Items ────────────────────────────────────────────
    onProgress?.('Engineering system failures...');
    combinedLog('GENERATION', 'Starting Layer 2: Systems & Items');

    const systemsItems = generateSystemsItemsProcedural(topology, combinedLog);
    context['systemsItems'] = systemsItems;
    combinedLog('GENERATION', `Layer 2 complete: ${String(systemsItems.roomFailures.length)} rooms with failures, ${String(systemsItems.items.length)} items`);

    // ─── Layer 3: Objectives & NPCs ──────────────────────────────────────────
    onProgress?.('Designing mission objectives...');
    combinedLog('GENERATION', 'Starting Layer 3: Objectives & NPCs');

    const objectivesNPCs = await runLayer(
        objectivesNPCsLayer,
        context,
        config.aiClient,
        config.modelId,
        onProgress,
        po,
        combinedLog,
    );
    context['objectivesNPCs'] = objectivesNPCs;
    combinedLog('GENERATION', `Layer 3 complete: ${String(objectivesNPCs.objectives.steps.length)} objective steps, ${String(objectivesNPCs.npcs.length)} NPCs`);

    // ─── Layer 4: Creative Content (parallel sub-layers) ────────────────────
    combinedLog('GENERATION', 'Starting Layer 4: Creative (parallel sub-layers)');

    const creative = await runCreativeSublayers(
        context,
        config.aiClient,
        config.modelId,
        onProgress,
        po,
        combinedLog,
    );
    combinedLog('GENERATION', `Layer 4 complete: ${creative.stationName}`);

    // Rename log file with station name
    logger.finalize(creative.stationName);

    // ─── Assemble StationSkeleton from validated layers ──────────────────────
    onProgress?.('Assembling station data...');

    const depths = computeDepths(topology.entryRoomId, topology.rooms.map(r => ({
        id: r.id,
        connections: r.connections,
    })) as RoomSkeleton[]);

    // Build RoomSkeleton[] from topology + systems/items + objectives
    const objectiveRoomIds = new Set(objectivesNPCs.objectives.steps.map(s => s.roomId));
    const roomSkeletons: RoomSkeleton[] = topology.rooms.map(r => {
        const failures = systemsItems.roomFailures.find(rf => rf.roomId === r.id);
        const lootItems = systemsItems.items.filter(i => i.roomId === r.id);

        const lootSlots: ItemSkeleton[] = lootItems.map(lootItem => {
            const engItem = lootItem.baseItemKey === 'keycard' ? null : ENGINEERING_ITEMS.get(lootItem.baseItemKey);
            return {
                id: lootItem.id,
                category: engItem?.category ?? (lootItem.isKeyItem ? 'key' : 'material'),
                effect: engItem?.effect ?? {
                    type: lootItem.isKeyItem ? 'key' as const : 'material' as const,
                    value: lootItem.isKeyItem ? 0 : 1,
                    description: lootItem.baseItemKey.replace(/_/g, ' '),
                },
                isKeyItem: lootItem.isKeyItem,
            };
        });

        const skFailures: SystemFailureSkeleton[] = (failures?.failures ?? []).map(f => ({
            systemId: f.systemId,
            failureMode: f.failureMode,
            severity: f.severity,
            requiredMaterials: [...f.requiredMaterials],
            requiredSkill: f.requiredSkill,
            difficulty: difficultyForSeverity(f.severity),
            minutesUntilCascade: f.minutesUntilCascade,
            cascadeTarget: f.cascadeTarget,
            hazardPerMinute: f.severity === 1 ? 0 : (f.severity === 2 ? 0.2 : 0.5),
            diagnosisHint: f.diagnosisHint,
            mitigationPaths: [...f.mitigationPaths],
        }));

        return {
            id: r.id,
            archetype: r.archetype,
            depth: depths.get(r.id) ?? 0,
            connections: [...r.connections],
            lockedBy: r.lockedBy,
            lootSlots,
            isObjectiveRoom: objectiveRoomIds.has(r.id),
            secretConnection: null,
            systemFailures: skFailures,
        };
    });

    // Build ItemSkeleton[] — all items from Layer 2
    const itemSkeletons: ItemSkeleton[] = systemsItems.items.map(item => {
        const engItem = item.baseItemKey === 'keycard' ? null : ENGINEERING_ITEMS.get(item.baseItemKey);
        return {
            id: item.id,
            category: engItem?.category ?? (item.isKeyItem ? 'key' : 'material'),
            effect: engItem?.effect ?? {
                type: item.isKeyItem ? 'key' as const : 'material' as const,
                value: item.isKeyItem ? 0 : 1,
                description: item.baseItemKey.replace(/_/g, ' '),
            },
            isKeyItem: item.isKeyItem,
        };
    });

    // Build ObjectiveChain
    const objectives: ObjectiveChain = {
        storyArc: 'cascade_failure', // AI doesn't use fixed story arcs — scenario theme replaces it
        title: objectivesNPCs.objectives.title,
        steps: objectivesNPCs.objectives.steps.map(s => ({
            id: s.id,
            description: s.description,
            roomId: s.roomId,
            requiredItemId: s.requiredItemId,
            requiredSystemRepair: s.requiredSystemRepair,
            completed: false,
        })),
        currentStepIndex: 0,
        completed: false,
    };

    const skeleton: StationSkeleton = {
        config: {
            seed: Math.floor(Math.random() * 2147483647),
            difficulty: config.difficulty,
            storyArc: 'cascade_failure', // Placeholder — actual scenario stored in skeleton.scenario
            characterClass: config.characterClass,
        },
        rooms: roomSkeletons,
        items: itemSkeletons,
        objectives,
        entryRoomId: topology.entryRoomId,
        escapeRoomId: topology.escapeRoomId,
        npcConcepts: objectivesNPCs.npcs.length > 0 ? objectivesNPCs.npcs : undefined,
        scenario: topology.scenario,
    };

    return { skeleton, creative };
}
