import type {
    StationSkeleton,
    CreativeContent,
    GeneratedStation,
    Room,
    NPC,
    Item,
    NPCMemory,
    NPCBehaviorFlag,
} from './types.js';

function makeNPCMemory(): NPCMemory {
    return {
        playerActions: [],
        dispositionHistory: [],
        wasSpared: false,
        wasHelped: false,
        hasFled: false,
        fledTo: null,
        tradeInventory: [],
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
            loot: skRoom.lootSlot?.id ?? null,
            threat: skRoom.enemySlot?.id ?? null,
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
        });
    }

    // Build NPC map from enemy skeletons
    for (const skEnemy of skeleton.enemies) {
        const cr = creative.enemies.find(e => e.enemyId === skEnemy.id);
        // Find which room this enemy is in
        const hostRoom = skeleton.rooms.find(r => r.enemySlot?.id === skEnemy.id);

        npcs.set(skEnemy.id, {
            id: skEnemy.id,
            name: cr?.name ?? `Entity-${String(skEnemy.tier)}`,
            roomId: hostRoom?.id ?? skeleton.entryRoomId,
            disposition: 'hostile',
            maxHp: skEnemy.hp,
            currentHp: skEnemy.hp,
            damage: [...skEnemy.damage],
            drop: skEnemy.dropItemId,
            behaviors: new Set<NPCBehaviorFlag>(skEnemy.behaviors),
            memory: makeNPCMemory(),
            fleeThreshold: skEnemy.fleeThreshold,
            personality: cr?.personality ?? skEnemy.personality,
            isAlly: false,
            appearance: cr?.appearance ?? 'A twisted form in the shadows.',
            deathDescription: cr?.deathDescription ?? 'It falls silent.',
            soundSignature: cr?.soundSignature ?? 'A low growl.',
            tier: skEnemy.tier,
        });
    }

    // Build item map
    for (const skItem of skeleton.items) {
        const cr = creative.items.find(i => i.itemId === skItem.id);

        items.set(skItem.id, {
            id: skItem.id,
            name: cr?.name ?? skItem.id.replace(/_/g, ' '),
            description: cr?.description ?? skItem.effect.description,
            category: skItem.category,
            effect: { ...skItem.effect },
            isKeyItem: skItem.isKeyItem,
            useNarration: cr?.useNarration ?? `You use the ${skItem.id.replace(/_/g, ' ')}.`,
        });
    }

    return {
        config: skeleton.config,
        stationName: creative.stationName,
        briefing: creative.briefing,
        backstory: creative.backstory,
        rooms,
        npcs,
        items,
        objectives: { ...skeleton.objectives, steps: skeleton.objectives.steps.map(s => ({ ...s })) },
        entryRoomId: skeleton.entryRoomId,
        escapeRoomId: skeleton.escapeRoomId,
        crewRoster: [...creative.crewRoster],
    };
}
