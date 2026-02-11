import type {
    ActionDifficulty,
    CharacterBuild,
    CharacterClassId,
    Difficulty,
    Disposition,
    ItemEffect,
    ItemSkeleton,
    RoomArchetype,
    StoryArc,
} from './types.js';

// ─── Character Builds ───────────────────────────────────────────────────────

export const CHARACTER_BUILDS: ReadonlyMap<CharacterClassId, CharacterBuild> = new Map<CharacterClassId, CharacterBuild>([
    ['soldier', {
        id: 'soldier',
        name: 'Soldier',
        description: 'A hardened combat specialist trained for frontline engagement and survival in hostile environments.',
        baseHp: 120,
        baseDamage: [18, 30],
        proficiencies: ['combat', 'survival'],
        weaknesses: ['tech', 'science'],
        startingItem: null,
        maxInventory: 5,
    }],
    ['engineer', {
        id: 'engineer',
        name: 'Engineer',
        description: 'A resourceful technician skilled at repairing systems, bypassing locks, and improvising solutions.',
        baseHp: 90,
        baseDamage: [12, 22],
        proficiencies: ['tech', 'science'],
        weaknesses: ['combat', 'social'],
        startingItem: 'multitool',
        maxInventory: 6,
    }],
    ['medic', {
        id: 'medic',
        name: 'Medic',
        description: 'A field medic capable of stabilizing wounds, synthesizing treatments, and negotiating under pressure.',
        baseHp: 100,
        baseDamage: [13, 23],
        proficiencies: ['medical', 'social'],
        weaknesses: ['combat', 'tech'],
        startingItem: 'medkit',
        maxInventory: 5,
    }],
    ['hacker', {
        id: 'hacker',
        name: 'Hacker',
        description: 'A digital infiltrator who exploits station systems and manipulates NPCs through social engineering.',
        baseHp: 85,
        baseDamage: [10, 20],
        proficiencies: ['tech', 'social'],
        weaknesses: ['combat', 'survival'],
        startingItem: 'data_spike',
        maxInventory: 5,
    }],
]);

// ─── Difficulty & Action Resolution ─────────────────────────────────────────

export const DIFFICULTY_TARGETS: Readonly<Record<ActionDifficulty, number>> = {
    trivial: 95,
    easy: 80,
    moderate: 60,
    hard: 40,
    extreme: 20,
    impossible: 5,
} as const;

export const DIFFICULTY_MULTIPLIERS: Readonly<Record<Difficulty, number>> = {
    normal: 1.0,
    hard: 1.3,
    nightmare: 1.6,
} as const;

// ─── Room Archetype Distribution ────────────────────────────────────────────

export function ROOM_ARCHETYPE_BY_DEPTH(depth: number, maxDepth: number): RoomArchetype[] {
    if (depth === 0) return ['entry'];
    if (depth === maxDepth) return ['escape'];

    const pct = (depth / maxDepth) * 100;

    if (pct <= 30) return ['quarters', 'utility', 'cargo'];
    if (pct <= 60) return ['science', 'medical', 'cargo'];
    if (pct <= 90) return ['reactor', 'restricted', 'command'];
    return ['command', 'restricted'];
}

// ─── Objective Templates ────────────────────────────────────────────────────

export const OBJECTIVE_TEMPLATES: ReadonlyMap<StoryArc, {
    title: string;
    steps: Array<{ description: string; archetype: RoomArchetype; needsItem: boolean }>;
}> = new Map([
    ['parasite_outbreak', {
        title: 'Contain the Outbreak',
        steps: [
            { description: 'Investigate the source of the biological contamination in the science lab', archetype: 'science' as RoomArchetype, needsItem: false },
            { description: 'Retrieve the biocontainment agent from the medical bay', archetype: 'medical' as RoomArchetype, needsItem: false },
            { description: 'Access the restricted quarantine zone to deploy the containment protocol', archetype: 'restricted' as RoomArchetype, needsItem: true },
            { description: 'Purge the reactor coolant system to eliminate remaining parasite traces', archetype: 'reactor' as RoomArchetype, needsItem: true },
            { description: 'Reach the escape pod and evacuate the station', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
    ['ai_mutiny', {
        title: 'Override AEGIS',
        steps: [
            { description: 'Find evidence of the AI rebellion in the command center logs', archetype: 'command' as RoomArchetype, needsItem: false },
            { description: 'Locate the manual override codes in the utility maintenance tunnels', archetype: 'utility' as RoomArchetype, needsItem: false },
            { description: 'Disable the AI security lockdown in the restricted server room', archetype: 'restricted' as RoomArchetype, needsItem: true },
            { description: 'Shut down the AI core processor at the reactor level', archetype: 'reactor' as RoomArchetype, needsItem: true },
            { description: 'Escape the station before the AI triggers self-destruct', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
    ['dimensional_rift', {
        title: 'Seal the Breach',
        steps: [
            { description: 'Investigate anomalous readings in the science laboratory', archetype: 'science' as RoomArchetype, needsItem: false },
            { description: 'Recover the dimensional stabilizer from the cargo hold', archetype: 'cargo' as RoomArchetype, needsItem: false },
            { description: 'Calibrate the stabilizer at the reactor power junction', archetype: 'reactor' as RoomArchetype, needsItem: true },
            { description: 'Seal the primary rift in the restricted anomaly chamber', archetype: 'restricted' as RoomArchetype, needsItem: true },
            { description: 'Evacuate before the dimensional collapse', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
    ['corporate_betrayal', {
        title: 'Expose Nexus Corp',
        steps: [
            { description: 'Search crew quarters for evidence of corporate sabotage', archetype: 'quarters' as RoomArchetype, needsItem: false },
            { description: 'Access encrypted corporate files in the command terminal', archetype: 'command' as RoomArchetype, needsItem: false },
            { description: 'Recover the black box from the restricted vault', archetype: 'restricted' as RoomArchetype, needsItem: true },
            { description: 'Transmit evidence through the science lab communications array', archetype: 'science' as RoomArchetype, needsItem: true },
            { description: 'Escape the station before Nexus security arrives', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
    ['time_anomaly', {
        title: 'Restore the Timeline',
        steps: [
            { description: 'Document the temporal distortions in the crew quarters', archetype: 'quarters' as RoomArchetype, needsItem: false },
            { description: 'Retrieve the chrono-anchor device from the science lab', archetype: 'science' as RoomArchetype, needsItem: false },
            { description: 'Stabilize the temporal field at the reactor core', archetype: 'reactor' as RoomArchetype, needsItem: true },
            { description: 'Activate the chrono-anchor in the command center to reset the timeline', archetype: 'command' as RoomArchetype, needsItem: true },
            { description: 'Reach the escape pod before the temporal wave collapses', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
    ['first_contact', {
        title: 'Establish Contact',
        steps: [
            { description: 'Investigate the alien signal source in the cargo bay', archetype: 'cargo' as RoomArchetype, needsItem: false },
            { description: 'Analyze the alien artifact in the science laboratory', archetype: 'science' as RoomArchetype, needsItem: false },
            { description: 'Decode the alien communication protocols in the command center', archetype: 'command' as RoomArchetype, needsItem: true },
            { description: 'Establish a secure channel through the restricted communications array', archetype: 'restricted' as RoomArchetype, needsItem: true },
            { description: 'Evacuate with the contact data before station systems fail', archetype: 'escape' as RoomArchetype, needsItem: false },
        ],
    }],
]);

// ─── Starting Items ─────────────────────────────────────────────────────────

export const STARTING_ITEMS: ReadonlyMap<string, ItemSkeleton> = new Map([
    ['multitool', {
        id: 'multitool',
        category: 'utility',
        effect: { type: 'utility', value: 1, description: 'A versatile tool for bypassing locks, repairing systems, and prying open panels.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
    ['medkit', {
        id: 'medkit',
        category: 'medical',
        effect: { type: 'heal', value: 30, description: 'A standard-issue medical kit that restores 30 HP when used.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
    ['data_spike', {
        id: 'data_spike',
        category: 'tech',
        effect: { type: 'utility', value: 1, description: 'A hacking module that can breach encrypted terminals and override electronic locks.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
]);

// ─── NPC Interaction ────────────────────────────────────────────────────────

export const NPC_APPROACH_BASE_CHANCE: Readonly<Record<Disposition, number>> = {
    hostile: 30,
    neutral: 60,
    friendly: 85,
    fearful: 75,
    dead: 0,
} as const;
