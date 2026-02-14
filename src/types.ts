import type { TextChunk } from '@opentui/core';
import type { EnvironmentReadout } from './environment.js';

// ─── Story & World Configuration ────────────────────────────────────────────

export type StoryArc =
    | 'cascade_failure'
    | 'atmosphere_breach'
    | 'reactor_meltdown'
    | 'contamination_crisis'
    | 'power_death_spiral'
    | 'orbital_decay';

export type Difficulty = 'normal' | 'hard' | 'nightmare';

export interface RunConfig {
    seed: number;
    difficulty: Difficulty;
    storyArc: StoryArc;
}

// ─── Character System ───────────────────────────────────────────────────────

export type CharacterClassId = 'engineer' | 'scientist' | 'medic' | 'commander';

export type ActionDomain = 'tech' | 'medical' | 'social' | 'survival' | 'science';

export interface CharacterBuild {
    id: CharacterClassId;
    name: string;
    description: string;
    baseHp: number;
    proficiencies: ActionDomain[];
    weaknesses: ActionDomain[];
    startingItem: string | null;
    maxInventory: number;
}

// ─── Room System ────────────────────────────────────────────────────────────

export type RoomArchetype =
    | 'entry'
    | 'quarters'
    | 'utility'
    | 'science'
    | 'command'
    | 'medical'
    | 'cargo'
    | 'restricted'
    | 'reactor'
    | 'escape';

export interface RoomSensory {
    sounds: string[];
    smells: string[];
    visuals: string[];
    tactile: string;
}

export interface CrewLog {
    type: 'datapad' | 'wall_scrawl' | 'audio_recording' | 'terminal_entry' | 'engineering_report' | 'calibration_record' | 'failure_analysis';
    author: string;
    content: string;
    condition: string;
}

// ─── Engineering System ─────────────────────────────────────────────────────

export type SystemId =
    | 'life_support'
    | 'pressure_seal'
    | 'power_relay'
    | 'coolant_loop'
    | 'atmosphere_processor'
    | 'gravity_generator'
    | 'radiation_shielding'
    | 'communications'
    | 'fire_suppression'
    | 'water_recycler'
    | 'thermal_regulator'
    | 'structural_integrity';

export type SystemStatus = 'nominal' | 'degraded' | 'failing' | 'critical' | 'offline' | 'repaired';

export type FailureMode = 'leak' | 'overload' | 'contamination' | 'structural' | 'blockage' | 'corrosion' | 'software' | 'mechanical';

export type ChallengeState = 'detected' | 'characterized' | 'stabilized' | 'resolved' | 'failed';

export interface SystemFailure {
    systemId: SystemId;
    status: SystemStatus;
    failureMode: FailureMode;
    severity: 1 | 2 | 3;
    challengeState: ChallengeState;
    requiredMaterials: string[];
    requiredSkill: ActionDomain;
    difficulty: ActionDifficulty;
    turnsUntilCascade: number;
    cascadeTarget: string | null;
    hazardPerTurn: number;
    diagnosisHint: string;
    technicalDetail: string;
    mitigationPaths: string[];
}

export interface SystemFailureSkeleton {
    systemId: SystemId;
    failureMode: FailureMode;
    severity: 1 | 2 | 3;
    requiredMaterials: string[];
    requiredSkill: ActionDomain;
    difficulty: ActionDifficulty;
    turnsUntilCascade: number;
    cascadeTarget: string | null;
    hazardPerTurn: number;
    diagnosisHint: string;
    mitigationPaths: string[];
}

// ─── NPC System ─────────────────────────────────────────────────────────────

export type Disposition = 'neutral' | 'friendly' | 'fearful';

export type NPCBehaviorFlag =
    | 'can_negotiate'
    | 'can_ally'
    | 'can_trade'
    | 'is_intelligent';

export interface NPCMemory {
    playerActions: string[];
    dispositionHistory: Array<{ turn: number; from: Disposition; to: Disposition; reason: string }>;
    wasSpared: boolean;
    wasHelped: boolean;
    tradeInventory: string[];
}

// ─── Item System ────────────────────────────────────────────────────────────

export type ItemEffectType = 'heal' | 'key' | 'objective' | 'utility' | 'trade' | 'material' | 'tool' | 'component' | 'chemical';

export interface ItemEffect {
    type: ItemEffectType;
    value: number;
    duration?: number;
    description: string;
}

// ─── Skeleton Types (TypeScript-generated, structural) ──────────────────────

export interface RoomSkeleton {
    id: string;
    archetype: RoomArchetype;
    depth: number;
    connections: string[];
    lockedBy: string | null;
    lootSlot: ItemSkeleton | null;
    isObjectiveRoom: boolean;
    secretConnection: string | null;
    systemFailures: SystemFailureSkeleton[];
}

export interface ItemSkeleton {
    id: string;
    category: string;
    effect: ItemEffect;
    isKeyItem: boolean;
}

export interface ObjectiveStep {
    id: string;
    description: string;
    roomId: string;
    requiredItemId: string | null;
    requiredSystemRepair: SystemId | null;
    completed: boolean;
}

export interface ObjectiveChain {
    storyArc: StoryArc;
    title: string;
    steps: ObjectiveStep[];
    currentStepIndex: number;
    completed: boolean;
}

export interface StationSkeleton {
    config: RunConfig;
    rooms: RoomSkeleton[];
    items: ItemSkeleton[];
    objectives: ObjectiveChain;
    entryRoomId: string;
    escapeRoomId: string;
}

// ─── Map Layout (procedural, topology-safe) ────────────────────────────────

export interface MapLayout {
    seed: number;
    positions: Map<string, { x: number; y: number }>;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    scaleHint: { dx: number; dy: number };
}

// ─── Creative Types (AI-generated, narrative) ───────────────────────────────

export interface RoomCreative {
    roomId: string;
    name: string;
    descriptionSeed: string;
    sensory: RoomSensory;
    crewLogs: CrewLog[];
    engineeringNotes: string;
}

export interface ItemCreative {
    itemId: string;
    name: string;
    description: string;
    useNarration: string;
}

export interface CrewMember {
    name: string;
    role: string;
    fate: string;
}

export interface CreativeContent {
    stationName: string;
    briefing: string;
    backstory: string;
    crewRoster: CrewMember[];
    rooms: RoomCreative[];
    items: ItemCreative[];
}

// ─── Assembled World (final, used during gameplay) ──────────────────────────

export interface Room {
    id: string;
    archetype: RoomArchetype;
    name: string;
    descriptionSeed: string;
    depth: number;
    connections: string[];
    lockedBy: string | null;
    loot: string | null;
    sensory: RoomSensory;
    crewLogs: CrewLog[];
    isObjectiveRoom: boolean;
    secretConnection: string | null;
    roomModifiers: string[];
    systemFailures: SystemFailure[];
    engineeringNotes: string;
}

export interface NPC {
    id: string;
    name: string;
    roomId: string;
    disposition: Disposition;
    behaviors: Set<NPCBehaviorFlag>;
    memory: NPCMemory;
    personality: string;
    isAlly: boolean;
    appearance: string;
    soundSignature: string;
}

export interface Item {
    id: string;
    name: string;
    description: string;
    category: string;
    effect: ItemEffect;
    isKeyItem: boolean;
    useNarration: string;
}

export interface GeneratedStation {
    config: RunConfig;
    stationName: string;
    briefing: string;
    backstory: string;
    rooms: Map<string, Room>;
    npcs: Map<string, NPC>;
    items: Map<string, Item>;
    objectives: ObjectiveChain;
    entryRoomId: string;
    escapeRoomId: string;
    crewRoster: CrewMember[];
    mapLayout: MapLayout;
}

// ─── Moral Choices ──────────────────────────────────────────────────────────

export interface MoralChoice {
    turn: number;
    description: string;
    tendency: 'mercy' | 'sacrifice' | 'pragmatic';
    magnitude: number;
}

export interface MoralProfile {
    choices: MoralChoice[];
    tendencies: { mercy: number; sacrifice: number; pragmatic: number };
    endingFlags: Set<string>;
}

// ─── Creative Action Resolution ─────────────────────────────────────────────

export type ActionDifficulty = 'trivial' | 'easy' | 'moderate' | 'hard' | 'extreme' | 'impossible';

export type ActionOutcome = 'critical_success' | 'success' | 'partial_success' | 'failure' | 'critical_failure';

export interface ActionResult {
    outcome: ActionOutcome;
    roll: number;
    target: number;
    modifiers: Record<string, number>;
    damageDealt: number;
    description: string;
}

// ─── Random Events ──────────────────────────────────────────────────────────

export type EventType = 'hull_breach' | 'power_failure' | 'distress_signal' | 'radiation_spike' | 'supply_cache' | 'cascade_failure' | 'atmosphere_alarm' | 'coolant_leak' | 'structural_alert';

export interface ActiveEvent {
    type: EventType;
    description: string;
    turnsRemaining: number;
    effect: string;
}

// ─── Run Metrics & Scoring ──────────────────────────────────────────────────

export interface RunMetrics {
    runId: string;
    characterClass: CharacterClassId;
    storyArc: StoryArc;
    difficulty: Difficulty;
    startTime: number;
    endTime: number | null;
    turnCount: number;
    moveCount: number;
    totalDamageTaken: number;
    totalDamageHealed: number;
    roomsVisited: Set<string>;
    itemsUsed: string[];
    itemsCollected: string[];
    crewLogsFound: number;
    creativeActionsAttempted: number;
    npcInteractions: number;
    deathCause: string | null;
    won: boolean;
    endingId: string | null;
    systemsDiagnosed: number;
    systemsRepaired: number;
    systemsCascaded: number;
    itemsCrafted: number;
    improvizedSolutions: number;
}

export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface RunScore {
    speed: number;
    engineeringEfficiency: number;
    exploration: number;
    resourcefulness: number;
    completion: number;
    total: number;
    grade: ScoreGrade;
}

export interface RunHistoryEntry {
    runId: string;
    characterClass: CharacterClassId;
    storyArc: StoryArc;
    difficulty: Difficulty;
    won: boolean;
    endingId: string | null;
    score: RunScore;
    turnCount: number;
    duration: number;
    date: string;
}

// ─── Game State ─────────────────────────────────────────────────────────────

export interface GameState {
    hp: number;
    maxHp: number;
    oxygen: number;
    maxOxygen: number;
    suitIntegrity: number;
    inventory: string[];
    maxInventory: number;
    currentRoom: string;
    roomsVisited: Set<string>;
    roomLootTaken: Set<string>;
    revealedItems: Set<string>;
    hasObjectiveItem: boolean;
    gameOver: boolean;
    won: boolean;
    repairedSystems: Set<string>;
    craftedItems: string[];
    systemsCascaded: number;
    improvizedSolutions: number;
    roomVisitCount: Map<string, number>;
    turnCount: number;
    moveCount: number;
    characterClass: CharacterClassId;
    activeEvents: ActiveEvent[];
    moralProfile: MoralProfile;
    metrics: RunMetrics;
    fieldSurgeryUsedInRoom: Set<string>;
    npcAllies: Set<string>;
    missionElapsedMinutes: number;
}

export interface GameStatus {
    hp: number;
    maxHp: number;
    oxygen: number;
    maxOxygen: number;
    suitIntegrity: number;
    roomName: string;
    roomIndex: number;
    totalRooms: number;
    inventory: string[];
    inventoryKeyFlags: boolean[];
    characterClass: CharacterClassId;
    turnCount: number;
    maxInventory: number;
    activeEvents: Array<{ type: string; turnsRemaining: number; effect: string }>;
    objectiveTitle: string;
    objectiveStep: number;
    objectiveTotal: number;
    objectiveCurrentDesc: string;
    objectivesComplete: boolean;
    objectiveSteps: Array<{ description: string; completed: boolean }>;
    mapText: TextChunk[];
    systemFailures: Array<{ systemId: SystemId; status: SystemStatus; challengeState: ChallengeState; severity: 1 | 2 | 3; turnsUntilCascade: number }>;
    environment: EnvironmentReadout | null;
    missionElapsedMinutes: number;
}

// ─── Slash Commands (for TUI) ───────────────────────────────────────────────

export interface SlashCommandDef {
    name: string;
    description: string;
    needsTarget: boolean;
    getTargets: () => { label: string; value: string }[];
    toPrompt: (target?: string) => string;
}
