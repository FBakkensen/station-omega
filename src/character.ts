import type {
    ActionDomain,
    CharacterBuild,
    CharacterClassId,
    Difficulty,
    GameState,
    RunMetrics,
} from './types.js';
import {
    CHARACTER_BUILDS,
    STARTING_ITEMS,
} from './data.js';

// Re-export for convenience
export { CHARACTER_BUILDS };

// ─── Proficiency / Weakness Modifiers ───────────────────────────────────────

const PROFICIENCY_BONUS = 15;
const WEAKNESS_PENALTY = -15;

export function getProficiencyModifier(
    build: CharacterBuild,
    domain: ActionDomain,
): number {
    if (build.proficiencies.includes(domain)) return PROFICIENCY_BONUS;
    if (build.weaknesses.includes(domain)) return WEAKNESS_PENALTY;
    return 0;
}

// ─── Starting Items ─────────────────────────────────────────────────────────

function getStartingInventory(build: CharacterBuild): string[] {
    if (build.startingItem === null) return [];
    const item = STARTING_ITEMS.get(build.startingItem);
    if (!item) return [];
    return [item.id];
}

// ─── Game State Initialization ──────────────────────────────────────────────

export function initializePlayerState(
    classId: CharacterClassId,
    entryRoomId: string,
    runId: string,
    storyArc: GameState['metrics']['storyArc'],
    difficulty: Difficulty,
): GameState {
    const build = CHARACTER_BUILDS.get(classId);
    if (!build) {
        throw new Error(`Unknown character class: ${classId}`);
    }

    const startingInventory = getStartingInventory(build);

    const metrics: RunMetrics = {
        runId,
        characterClass: classId,
        storyArc,
        difficulty,
        startTime: Date.now(),
        endTime: null,
        turnCount: 0,
        missionElapsedMinutes: 0,
        moveCount: 0,
        totalDamageTaken: 0,
        totalDamageHealed: 0,
        roomsVisited: new Set<string>([entryRoomId]),
        itemsUsed: [],
        itemsCollected: [...startingInventory],
        crewLogsFound: 0,
        creativeActionsAttempted: 0,
        npcInteractions: 0,
        deathCause: null,
        won: false,
        endingId: null,
        systemsDiagnosed: 0,
        systemsRepaired: 0,
        systemsCascaded: 0,
        itemsCrafted: 0,
        improvizedSolutions: 0,
    };

    return {
        hp: build.baseHp,
        maxHp: build.baseHp,
        oxygen: 100,
        maxOxygen: 100,
        suitIntegrity: 100,
        inventory: startingInventory,
        maxInventory: build.maxInventory,
        currentRoom: entryRoomId,
        roomsVisited: new Set<string>([entryRoomId]),
        itemsTaken: new Set<string>(),
        revealedItems: new Set<string>(),
        hasObjectiveItem: false,
        gameOver: false,
        won: false,
        repairedSystems: new Set<string>(),
        craftedItems: [],
        systemsCascaded: 0,
        improvizedSolutions: 0,
        roomVisitCount: new Map<string, number>([[entryRoomId, 1]]),
        turnCount: 0,
        moveCount: 0,
        characterClass: classId,
        activeEvents: [],
        moralProfile: {
            choices: [],
            tendencies: { mercy: 0, sacrifice: 0, pragmatic: 0 },
            endingFlags: new Set<string>(),
        },
        metrics,
        fieldSurgeryUsedInRoom: new Set<string>(),
        npcAllies: new Set<string>(),
        missionElapsedMinutes: 0,
        eventCooldowns: {},
    };
}

// ─── Build Lookup ───────────────────────────────────────────────────────────

export function getBuild(classId: CharacterClassId): CharacterBuild {
    const build = CHARACTER_BUILDS.get(classId);
    if (!build) {
        throw new Error(`Unknown character class: ${classId}`);
    }
    return build;
}
