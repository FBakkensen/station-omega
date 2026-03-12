/**
 * Hazard Director — scores hazards from runtime station state, mission state,
 * and scenario theme. Replaces raw random event selection with state-aware
 * candidate scoring.
 *
 * The director is a stateless function: it computes a snapshot and decision
 * each turn from current game state, then steers existing event spawning.
 */

import type { GameState, GeneratedStation, EventType, SystemId } from './types.js';
import { computeEnvironment, type EnvironmentSnapshot } from './environment.js';
import { getEventDefinition } from './events.js';
import { getActiveObjectiveStep } from './objectives.js';
import { getDisasterFamily, getDisasterFamilyMeta, type DisasterFamilyId } from './generation/scenario-families.js';

// ─── Station Pressure Snapshot ──────────────────────────────────────────────

export interface StationPressureSnapshot {
    missionElapsedMinutes: number;
    turnCount: number;
    scenarioTheme: string | null;
    scenarioCentralTension: string | null;
    disasterFamily: DisasterFamilyId;
    playerHpPct: number;
    playerOxygenPct: number;
    suitIntegrity: number;
    currentRoomId: string;
    unresolvedFailureCount: number;
    criticalFailureCount: number;
    soonestCascadeMinutes: number | null;
    currentRoomEnv: EnvironmentSnapshot;
    activeEventCount: number;
    activeHazardCount: number;
    objectiveBlockerType: 'none' | 'item' | 'repair' | 'both';
    objectiveCompletionFraction: number;
    difficulty: string;
    /** Pressure phase derived from elapsed time and station state. */
    pressurePhase: PressurePhase;
}

export type PressurePhase = 'establishing' | 'building' | 'crescendo' | 'break';

/** Persistent hazard event types that should be room-scoped. */
export const PERSISTENT_HAZARD_TYPES: readonly EventType[] = [
    'hull_breach', 'radiation_spike', 'atmosphere_alarm',
    'coolant_leak', 'structural_alert', 'fire_outbreak',
] as const;

/** Disruption events: localized but not direct body damage. */
export const DISRUPTION_EVENT_TYPES: readonly EventType[] = [
    'power_failure',
] as const;

/** Instant utility events: no persistent hazard lifecycle. */
export const INSTANT_EVENT_TYPES: readonly EventType[] = [
    'distress_signal', 'supply_cache',
] as const;

export function isPersistentHazard(type: EventType): boolean {
    return (PERSISTENT_HAZARD_TYPES as readonly string[]).includes(type);
}

export function isDisruptionEvent(type: EventType): boolean {
    return (DISRUPTION_EVENT_TYPES as readonly string[]).includes(type);
}

// ─── Hazard Director Decision ───────────────────────────────────────────────

export interface HazardDirectorDecision {
    /** Scored candidate events sorted by weight descending. */
    candidates: HazardCandidate[];
    /** Whether a new hazard should spawn this tick. */
    shouldSpawn: boolean;
    /** Current pressure phase. */
    phase: PressurePhase;
    /** Maximum concurrent active hazards allowed. */
    concurrencyLimit: number;
}

export interface HazardCandidate {
    type: EventType;
    weight: number;
    preferredRoomId?: string;
}

// ─── Snapshot Builder ───────────────────────────────────────────────────────

export function buildStationPressureSnapshot(
    state: GameState,
    station: GeneratedStation,
): StationPressureSnapshot {
    const theme = station.scenario?.theme ?? null;
    const centralTension = station.scenario?.centralTension ?? null;
    const disasterFamily = theme ? getDisasterFamily(theme) : 'multi_cascade_fallback';

    const currentRoom = station.rooms.get(state.currentRoom);
    const currentRoomEnv = currentRoom
        ? computeEnvironment(currentRoom, state.activeEvents.filter(e => !e.roomId || e.roomId === state.currentRoom))
        : computeEnvironment(
            { systemFailures: [], archetype: 'entry' } as unknown as import('./types.js').Room,
            [],
        );

    // Count failures across entire station
    let unresolvedFailureCount = 0;
    let criticalFailureCount = 0;
    let soonestCascadeMinutes: number | null = null;

    for (const room of station.rooms.values()) {
        for (const f of room.systemFailures) {
            if (f.challengeState === 'resolved' || f.challengeState === 'failed') continue;
            unresolvedFailureCount++;
            if (f.severity >= 3 || f.status === 'critical') criticalFailureCount++;
            if (f.minutesUntilCascade > 0) {
                if (soonestCascadeMinutes === null || f.minutesUntilCascade < soonestCascadeMinutes) {
                    soonestCascadeMinutes = f.minutesUntilCascade;
                }
            }
        }
    }

    // Objective state
    const activeStep = getActiveObjectiveStep(station.objectives);
    let objectiveBlockerType: 'none' | 'item' | 'repair' | 'both' = 'none';
    if (activeStep) {
        const needsItem = activeStep.requiredItemId && !state.inventory.includes(activeStep.requiredItemId) && !state.hasObjectiveItem;
        const needsRepair = activeStep.requiredSystemRepair && !(station.rooms.get(activeStep.roomId)?.systemFailures.some(
            f => f.systemId === activeStep.requiredSystemRepair && f.challengeState === 'resolved',
        ) ?? false);
        if (needsItem && needsRepair) objectiveBlockerType = 'both';
        else if (needsItem) objectiveBlockerType = 'item';
        else if (needsRepair) objectiveBlockerType = 'repair';
    }

    const totalSteps = station.objectives.steps.length;
    const completedSteps = station.objectives.steps.filter(s => s.completed).length;
    const objectiveCompletionFraction = totalSteps > 0 ? completedSteps / totalSteps : 0;

    const activeHazardCount = state.activeEvents.filter(e => isPersistentHazard(e.type)).length;

    return {
        missionElapsedMinutes: state.missionElapsedMinutes,
        turnCount: state.turnCount,
        scenarioTheme: theme,
        scenarioCentralTension: centralTension,
        disasterFamily,
        playerHpPct: state.hp / state.maxHp,
        playerOxygenPct: state.oxygen / state.maxOxygen,
        suitIntegrity: state.suitIntegrity,
        currentRoomId: state.currentRoom,
        unresolvedFailureCount,
        criticalFailureCount,
        soonestCascadeMinutes,
        currentRoomEnv,
        activeEventCount: state.activeEvents.length,
        activeHazardCount,
        objectiveBlockerType,
        objectiveCompletionFraction,
        difficulty: station.config.difficulty,
        pressurePhase: derivePressurePhase(state.missionElapsedMinutes, unresolvedFailureCount, objectiveCompletionFraction),
    };
}

// ─── Pressure Phase ─────────────────────────────────────────────────────────

function derivePressurePhase(
    elapsed: number,
    unresolvedFailures: number,
    completionFraction: number,
): PressurePhase {
    // Break: player just resolved something major
    if (completionFraction > 0.6 && unresolvedFailures <= 1) return 'break';
    // Crescendo: deep into mission with many problems
    if (elapsed >= 120 || unresolvedFailures >= 5) return 'crescendo';
    // Building: mission is underway
    if (elapsed >= 45 || unresolvedFailures >= 2) return 'building';
    // Establishing: early mission
    return 'establishing';
}

// ─── Director Decision ──────────────────────────────────────────────────────

/** Maximum concurrent persistent hazards by difficulty. */
const CONCURRENCY_LIMITS: Record<string, number> = {
    normal: 3,
    hard: 4,
    nightmare: 5,
};

/** Candidate event types the director can spawn as hazards. */
const SPAWNABLE_HAZARD_TYPES: EventType[] = [
    'hull_breach', 'radiation_spike', 'atmosphere_alarm',
    'coolant_leak', 'structural_alert', 'fire_outbreak', 'power_failure',
];

/** System failures that increase fire_outbreak weight when present in a room. */
const FIRE_CATALYST_SYSTEMS: SystemId[] = [
    'fire_suppression', 'power_relay', 'coolant_loop', 'thermal_regulator',
];

export function computeHazardDirectorDecision(
    snapshot: StationPressureSnapshot,
    state: GameState,
    station: GeneratedStation,
): HazardDirectorDecision {
    const concurrencyLimit = CONCURRENCY_LIMITS[snapshot.difficulty] ?? 3;
    const phase = snapshot.pressurePhase;

    // Should we spawn?
    const atCapacity = snapshot.activeHazardCount >= concurrencyLimit;
    const inBreak = phase === 'break';
    const tooEarly = snapshot.missionElapsedMinutes < 30;

    // Base spawn probability by phase
    const phaseProb: Record<PressurePhase, number> = {
        establishing: 0.05,
        building: 0.10,
        crescendo: 0.15,
        break: 0.03,
    };

    // Tension modifier (same formula as old system but capped)
    const tensionMod = Math.min(0.15, snapshot.missionElapsedMinutes / 500);
    const spawnProbability = phaseProb[phase] + tensionMod;

    // Suppress if saturated
    const shouldSpawn = !atCapacity && !tooEarly && !inBreak && Math.random() < spawnProbability;

    // Score candidates — pre-build lookup maps to avoid repeated O(n) scans
    const familyMeta = getDisasterFamilyMeta(snapshot.scenarioTheme ?? '');
    const candidates: HazardCandidate[] = [];

    const activeCountByType = new Map<EventType, number>();
    const activeCountByRoom = new Map<string, number>();
    const activeTypeRoomSet = new Set<string>();
    let hasStructuralAlert = false;
    for (const e of state.activeEvents) {
        activeCountByType.set(e.type, (activeCountByType.get(e.type) ?? 0) + 1);
        if (e.roomId) {
            activeCountByRoom.set(e.roomId, (activeCountByRoom.get(e.roomId) ?? 0) + 1);
            activeTypeRoomSet.add(`${e.type}:${e.roomId}`);
        }
        if (e.type === 'structural_alert') hasStructuralAlert = true;
    }

    for (const type of SPAWNABLE_HAZARD_TYPES) {
        // Skip types at per-type-per-station limit of 2 active
        if ((activeCountByType.get(type) ?? 0) >= 2) continue;

        let weight = 1.0;

        // Scenario alignment: boost family-aligned types
        if ((familyMeta.hazardAffinity as string[]).includes(type)) {
            weight *= 2.0;
        }
        if ((familyMeta.hazardSuppressed as string[]).includes(type)) {
            weight *= 0.3;
        }

        // Phase-based weight
        if (phase === 'crescendo') weight *= 1.3;
        if (phase === 'establishing') weight *= 0.7;

        // Find the best room for this hazard
        const preferredRoom = findPreferredRoom(type, state, station, familyMeta, activeCountByRoom, activeTypeRoomSet);
        if (preferredRoom) {
            // Boost if the room has a relevant failed system
            weight *= 1.3;
        }

        // fire_outbreak special: boost sharply when catalyst systems are failed
        if (type === 'fire_outbreak') {
            const catalystRooms = findRoomsWithFailedSystems(station, FIRE_CATALYST_SYSTEMS);
            if (catalystRooms.length > 0) weight *= 2.0;
        }

        // hull_breach special: boost after structural_alert activity
        if (type === 'hull_breach' && hasStructuralAlert) {
            weight *= 1.5;
        }

        candidates.push({
            type,
            weight,
            preferredRoomId: preferredRoom ?? undefined,
        });
    }

    // Sort by weight descending
    candidates.sort((a, b) => b.weight - a.weight);

    return { candidates, shouldSpawn, phase, concurrencyLimit };
}

// ─── Room Selection Helpers ─────────────────────────────────────────────────

function findPreferredRoom(
    eventType: EventType,
    state: GameState,
    station: GeneratedStation,
    familyMeta: import('./generation/scenario-families.js').DisasterFamilyMeta,
    activeCountByRoom: Map<string, number>,
    activeTypeRoomSet: Set<string>,
): string | null {
    const roomIds = [...station.rooms.keys()];
    let bestRoom: string | null = null;
    let bestScore = 0;

    for (const roomId of roomIds) {
        const room = station.rooms.get(roomId);
        if (!room) continue;

        // Don't stack too many hazards in one room
        if ((activeCountByRoom.get(roomId) ?? 0) >= 2) continue;

        // Don't put same event type in same room
        if (activeTypeRoomSet.has(`${eventType}:${roomId}`)) continue;

        let score = 1.0;

        // Favor rooms matching the family
        if (familyMeta.favoredRoomArchetypes.includes(room.archetype)) {
            score *= 1.5;
        }

        // Favor rooms with related system failures
        const hasRelatedFailure = room.systemFailures.some(f =>
            f.challengeState !== 'resolved' && f.challengeState !== 'failed' &&
            isSystemRelatedToEvent(f.systemId, eventType),
        );
        if (hasRelatedFailure) score *= 1.8;

        // Slight preference for rooms near the player (creates tension)
        if (roomId === state.currentRoom) score *= 1.3;
        if (room.connections.includes(state.currentRoom)) score *= 1.1;

        if (score > bestScore) {
            bestScore = score;
            bestRoom = roomId;
        }
    }

    return bestRoom;
}

function isSystemRelatedToEvent(systemId: SystemId, eventType: EventType): boolean {
    const def = getEventDefinition(eventType);
    return def?.resolvableBySystems.includes(systemId) ?? false;
}

function findRoomsWithFailedSystems(
    station: GeneratedStation,
    systemIds: SystemId[],
): string[] {
    const result: string[] = [];
    for (const [roomId, room] of station.rooms) {
        const hasFailed = room.systemFailures.some(f =>
            systemIds.includes(f.systemId) &&
            f.challengeState !== 'resolved',
        );
        if (hasFailed) result.push(roomId);
    }
    return result;
}

// ─── Director Context for Prompts ───────────────────────────────────────────

export function buildDisasterContext(snapshot: StationPressureSnapshot): string {
    const parts: string[] = [];

    if (snapshot.scenarioTheme) {
        parts.push(`DISASTER: ${snapshot.scenarioTheme}`);
    }
    if (snapshot.scenarioCentralTension) {
        parts.push(`CENTRAL TENSION: ${snapshot.scenarioCentralTension}`);
    }

    const familyMeta = getDisasterFamilyMeta(snapshot.scenarioTheme ?? '');
    parts.push(`DISASTER CLASS: ${familyMeta.displayName}`);
    parts.push(`PRESSURE PHASE: ${snapshot.pressurePhase}`);

    return parts.join('\n');
}
