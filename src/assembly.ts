import type {
    StationSkeleton,
    CreativeContent,
    GeneratedStation,
    Room,
    NPC,
    Item,
    SystemFailure,
    SystemFailureSkeleton,
} from './types.js';
import { generateMapLayout } from './map-layout.js';
import { normalizeObjectiveChainWithLegacySupport } from './objectives.js';

function assembleFailure(sk: SystemFailureSkeleton): SystemFailure {
    return {
        systemId: sk.systemId,
        status: sk.severity >= 3 ? 'critical' : (sk.severity >= 2 ? 'failing' : 'degraded'),
        failureMode: sk.failureMode,
        severity: sk.severity,
        challengeState: 'detected',
        requiredMaterials: [...sk.requiredMaterials],
        requiredSkill: sk.requiredSkill,
        difficulty: sk.difficulty,
        minutesUntilCascade: sk.minutesUntilCascade,
        cascadeTarget: sk.cascadeTarget,
        hazardPerMinute: sk.hazardPerMinute,
        diagnosisHint: sk.diagnosisHint,
        technicalDetail: '',
        mitigationPaths: [...sk.mitigationPaths],
    };
}

export function assembleStation(
    skeleton: StationSkeleton,
    creative: CreativeContent,
): GeneratedStation {
    const rooms = new Map<string, Room>();
    const npcs = new Map<string, NPC>();
    const items = new Map<string, Item>();

    // Build room map
    for (const skRoom of skeleton.rooms) {
        const cr = creative.rooms.find(r => r.roomId === skRoom.id);

        rooms.set(skRoom.id, {
            id: skRoom.id,
            archetype: skRoom.archetype,
            name: cr?.name ?? skRoom.archetype,
            descriptionSeed: cr?.descriptionSeed ?? `A ${skRoom.archetype} area.`,
            depth: skRoom.depth,
            connections: [...skRoom.connections],
            lockedBy: skRoom.lockedBy,
            loot: skRoom.lootSlots.map(s => s.id),
            sensory: cr?.sensory ?? {
                sounds: ['Distant hum of machinery'],
                smells: ['Stale air'],
                visuals: ['Dim emergency lighting'],
                tactile: 'Cold metal underfoot.',
            },
            crewLogs: cr?.crewLogs ?? [],
            isObjectiveRoom: skRoom.isObjectiveRoom,
            secretConnection: skRoom.secretConnection,
            roomModifiers: [],
            systemFailures: skRoom.systemFailures.map(assembleFailure),
            engineeringNotes: cr?.engineeringNotes ?? '',
        });
    }

    // Build item map
    for (const skItem of skeleton.items) {
        const cr = creative.items.find(i => i.itemId === skItem.id);

        items.set(skItem.id, {
            id: skItem.id,
            name: cr?.name ?? skItem.effect.description,
            description: cr?.description ?? skItem.effect.description,
            category: skItem.category,
            effect: { ...skItem.effect },
            isKeyItem: skItem.isKeyItem,
            useNarration: cr?.useNarration ?? `You use the ${skItem.effect.description}.`,
        });
    }

    // Build NPC map from skeleton concepts + creative content
    if (skeleton.npcConcepts && skeleton.npcConcepts.length > 0) {
        for (const concept of skeleton.npcConcepts) {
            const cr = creative.npcCreative?.find(n => n.npcId === concept.id);

            npcs.set(concept.id, {
                id: concept.id,
                name: cr?.name ?? concept.role,
                roomId: concept.roomId,
                disposition: concept.disposition,
                behaviors: new Set(concept.behaviors),
                memory: {
                    playerActions: [],
                    dispositionHistory: [],
                    wasSpared: false,
                    wasHelped: false,
                    tradeInventory: [],
                },
                personality: cr?.personality ?? '',
                isAlly: false,
                appearance: cr?.appearance ?? '',
                soundSignature: cr?.soundSignature ?? '',
            });
        }
    }

    // Create AI-generated starting item and place in entry room
    const startItem = creative.startingItem;
    items.set(startItem.id, {
        id: startItem.id,
        name: startItem.name,
        description: startItem.description,
        category: startItem.category,
        effect: {
            type: startItem.effectType,
            value: startItem.effectValue,
            description: startItem.effectDescription,
        },
        isKeyItem: false,
        useNarration: startItem.useNarration,
    });

    const entryRoom = rooms.get(skeleton.entryRoomId);
    if (entryRoom) {
        entryRoom.loot.push(startItem.id);
    }

    const mapLayout = generateMapLayout(rooms, skeleton.config.seed, skeleton.entryRoomId);

    const objectives = normalizeObjectiveChainWithLegacySupport({
        ...skeleton.objectives,
        steps: skeleton.objectives.steps.map(s => ({ ...s })),
    });

    return {
        config: skeleton.config,
        stationName: creative.stationName,
        briefing: creative.briefing,
        backstory: creative.backstory,
        rooms,
        npcs,
        items,
        objectives,
        entryRoomId: skeleton.entryRoomId,
        escapeRoomId: skeleton.escapeRoomId,
        crewRoster: [...creative.crewRoster],
        arrivalScenario: creative.arrivalScenario,
        mapLayout,
        visualStyleSeed: creative.visualStyleSeed,
    };
}
