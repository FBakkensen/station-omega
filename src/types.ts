// ─── Story & World Configuration ────────────────────────────────────────────

export type StoryArc =
    | 'parasite_outbreak'
    | 'ai_mutiny'
    | 'dimensional_rift'
    | 'corporate_betrayal'
    | 'time_anomaly'
    | 'first_contact';

export type Difficulty = 'normal' | 'hard' | 'nightmare';

export interface RunConfig {
    seed: number;
    difficulty: Difficulty;
    storyArc: StoryArc;
}

// ─── Character System ───────────────────────────────────────────────────────

export type CharacterClassId = 'engineer' | 'soldier' | 'medic' | 'hacker';

export type ActionDomain = 'combat' | 'tech' | 'medical' | 'social' | 'survival' | 'science';

export interface CharacterBuild {
    id: CharacterClassId;
    name: string;
    description: string;
    baseHp: number;
    baseDamage: [number, number];
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
    type: 'datapad' | 'wall_scrawl' | 'audio_recording' | 'terminal_entry';
    author: string;
    content: string;
    condition: string;
}

// ─── NPC System ─────────────────────────────────────────────────────────────

export type Disposition = 'hostile' | 'neutral' | 'friendly' | 'fearful' | 'dead';

export type NPCBehaviorFlag =
    | 'can_negotiate'
    | 'can_flee'
    | 'can_ambush'
    | 'can_reinforce'
    | 'can_ally'
    | 'can_trade'
    | 'can_beg'
    | 'is_intelligent';

export interface NPCMemory {
    playerActions: string[];
    dispositionHistory: Array<{ turn: number; from: Disposition; to: Disposition; reason: string }>;
    wasSpared: boolean;
    wasHelped: boolean;
    hasFled: boolean;
    fledTo: string | null;
    tradeInventory: string[];
}

// ─── Item System ────────────────────────────────────────────────────────────

export type ItemEffectType = 'heal' | 'damage_boost' | 'shield' | 'key' | 'objective' | 'utility' | 'trade';

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
    enemySlot: EnemySkeleton | null;
    isObjectiveRoom: boolean;
    secretConnection: string | null;
}

export interface EnemySkeleton {
    id: string;
    tier: 1 | 2 | 3 | 4;
    hp: number;
    damage: [number, number];
    dropItemId: string | null;
    behaviorHint: string;
    behaviors: NPCBehaviorFlag[];
    personality: string;
    fleeThreshold: number;
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
    enemies: EnemySkeleton[];
    objectives: ObjectiveChain;
    entryRoomId: string;
    escapeRoomId: string;
}

// ─── Creative Types (AI-generated, narrative) ───────────────────────────────

export interface RoomCreative {
    roomId: string;
    name: string;
    descriptionSeed: string;
    sensory: RoomSensory;
    crewLogs: CrewLog[];
}

export interface EnemyCreative {
    enemyId: string;
    name: string;
    appearance: string;
    personality: string;
    deathDescription: string;
    soundSignature: string;
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
    enemies: EnemyCreative[];
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
    threat: string | null;
    sensory: RoomSensory;
    crewLogs: CrewLog[];
    isObjectiveRoom: boolean;
    secretConnection: string | null;
    roomModifiers: string[];
}

export interface NPC {
    id: string;
    name: string;
    roomId: string;
    disposition: Disposition;
    maxHp: number;
    currentHp: number;
    damage: [number, number];
    drop: string | null;
    behaviors: Set<NPCBehaviorFlag>;
    memory: NPCMemory;
    fleeThreshold: number;
    personality: string;
    isAlly: boolean;
    appearance: string;
    deathDescription: string;
    soundSignature: string;
    tier: 1 | 2 | 3 | 4;
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

export type EventType = 'hull_breach' | 'power_failure' | 'distress_signal' | 'radiation_spike' | 'supply_cache';

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
    totalDamageDealt: number;
    totalDamageTaken: number;
    totalDamageHealed: number;
    enemiesDefeated: string[];
    roomsVisited: Set<string>;
    itemsUsed: string[];
    itemsCollected: string[];
    crewLogsFound: number;
    creativeActionsAttempted: number;
    npcInteractions: number;
    deathCause: string | null;
    won: boolean;
    endingId: string | null;
}

export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface RunScore {
    speed: number;
    combatEfficiency: number;
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
    damage: [number, number];
    inventory: string[];
    maxInventory: number;
    currentRoom: string;
    roomsVisited: Set<string>;
    roomLootTaken: Set<string>;
    roomDrops: Map<string, string>;
    revealedItems: Set<string>;
    hasObjectiveItem: boolean;
    gameOver: boolean;
    won: boolean;
    plasmaBoost: boolean;
    shieldActive: boolean;
    roomVisitCount: Map<string, number>;
    turnCount: number;
    moveCount: number;
    characterClass: CharacterClassId;
    activeEvents: ActiveEvent[];
    moralProfile: MoralProfile;
    metrics: RunMetrics;
    fieldSurgeryUsedInRoom: Set<string>;
    npcAllies: Set<string>;
}

// ─── NPC Display (for TUI) ─────────────────────────────────────────────────

export interface NPCDisplayInfo {
    name: string;
    disposition: Disposition;
    hpPct: number;
    currentHp: number;
    maxHp: number;
}

export interface GameStatus {
    hp: number;
    maxHp: number;
    roomName: string;
    roomIndex: number;
    totalRooms: number;
    inventory: string[];
    inventoryKeyFlags: boolean[];
    npcs: NPCDisplayInfo[];
    characterClass: CharacterClassId;
    turnCount: number;
    damage: [number, number];
    maxInventory: number;
    shieldActive: boolean;
    plasmaBoost: boolean;
    activeEvents: Array<{ type: string; turnsRemaining: number; effect: string }>;
    objectiveTitle: string;
    objectiveStep: number;
    objectiveTotal: number;
    objectiveCurrentDesc: string;
    objectivesComplete: boolean;
    objectiveSteps: Array<{ description: string; completed: boolean }>;
}

// ─── Slash Commands (for TUI) ───────────────────────────────────────────────

export interface SlashCommandDef {
    name: string;
    description: string;
    needsTarget: boolean;
    getTargets: () => { label: string; value: string }[];
    toPrompt: (target?: string) => string;
}
