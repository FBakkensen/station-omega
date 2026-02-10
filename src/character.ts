import type {
    ActionDifficulty,
    ActionDomain,
    ActionOutcome,
    ActionResult,
    CharacterBuild,
    CharacterClassId,
    Difficulty,
    GameState,
    RunMetrics,
} from './types.js';
import {
    CHARACTER_BUILDS,
    DIFFICULTY_MULTIPLIERS,
    DIFFICULTY_TARGETS,
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

// ─── Action Roll Resolution ─────────────────────────────────────────────────

export function resolveAction(
    build: CharacterBuild,
    domain: ActionDomain,
    difficulty: ActionDifficulty,
    difficultyLevel: Difficulty,
    extraModifiers?: Record<string, number>,
): ActionResult {
    const baseTarget = DIFFICULTY_TARGETS[difficulty];
    const profMod = getProficiencyModifier(build, domain);
    const diffMult = DIFFICULTY_MULTIPLIERS[difficultyLevel];

    const modifiers: Record<string, number> = {
        proficiency: profMod,
        ...extraModifiers,
    };

    const totalModifier = Object.values(modifiers).reduce((sum, v) => sum + v, 0);
    const adjustedTarget = Math.max(1, Math.min(99, Math.round((baseTarget + totalModifier) / diffMult)));

    const roll = Math.floor(Math.random() * 100) + 1;

    const outcome = determineOutcome(roll, adjustedTarget);

    const damageDealt = calculateDamage(build, outcome);

    return {
        outcome,
        roll,
        target: adjustedTarget,
        modifiers,
        damageDealt,
        description: describeOutcome(outcome),
    };
}

function determineOutcome(roll: number, target: number): ActionOutcome {
    if (roll <= Math.max(1, Math.floor(target * 0.15))) return 'critical_success';
    if (roll <= target) return 'success';
    if (roll <= target + 15) return 'partial_success';
    if (roll >= 96) return 'critical_failure';
    return 'failure';
}

function calculateDamage(build: CharacterBuild, outcome: ActionOutcome): number {
    const [minDmg, maxDmg] = build.baseDamage;
    const baseDmg = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;

    switch (outcome) {
        case 'critical_success': return Math.round(baseDmg * 1.75);
        case 'success': return baseDmg;
        case 'partial_success': return Math.round(baseDmg * 0.5);
        case 'failure': return 0;
        case 'critical_failure': return 0;
    }
}

function describeOutcome(outcome: ActionOutcome): string {
    switch (outcome) {
        case 'critical_success': return 'A devastating strike finds its mark perfectly.';
        case 'success': return 'The attack connects solidly.';
        case 'partial_success': return 'A glancing blow — some effect, but not ideal.';
        case 'failure': return 'The attempt fails to connect.';
        case 'critical_failure': return 'A catastrophic miss that leaves you exposed.';
    }
}

// ─── Starting Items ─────────────────────────────────────────────────────────

export function getStartingInventory(build: CharacterBuild): string[] {
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
        moveCount: 0,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalDamageHealed: 0,
        enemiesDefeated: [],
        roomsVisited: new Set<string>([entryRoomId]),
        itemsUsed: [],
        itemsCollected: [...startingInventory],
        crewLogsFound: 0,
        creativeActionsAttempted: 0,
        npcInteractions: 0,
        deathCause: null,
        won: false,
        endingId: null,
    };

    return {
        hp: build.baseHp,
        maxHp: build.baseHp,
        damage: [...build.baseDamage],
        inventory: startingInventory,
        maxInventory: build.maxInventory,
        currentRoom: entryRoomId,
        roomsVisited: new Set<string>([entryRoomId]),
        roomLootTaken: new Set<string>(),
        roomDrops: new Map<string, string>(),
        revealedItems: new Set<string>(),
        hasObjectiveItem: false,
        gameOver: false,
        won: false,
        plasmaBoost: false,
        shieldActive: false,
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

export function getAllClassIds(): CharacterClassId[] {
    return [...CHARACTER_BUILDS.keys()];
}
