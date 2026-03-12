import type { GameState, EventType, ActiveEvent, GeneratedStation, HazardSeverity } from './types.js';
import {
    buildStationPressureSnapshot,
    computeHazardDirectorDecision,
} from './hazard-director.js';

// ─── Event Definitions ──────────────────────────────────────────────────────

export interface EventDefinition {
    type: EventType;
    baseProbability: number;
    cooldownMinutes: number;
    minElapsedMinutes: number;
    hpThreshold?: number;
    effect: string;
    durationMinutes: [number, number];
    /** HP damage per minute to room occupant. */
    damagePerMinute: number;
    /** Suit damage per minute to room occupant. */
    suitDamagePerMinute: number;
    /** Oxygen drain per minute to room occupant. */
    oxygenDrainPerMinute: number;
    /** Global station oxygen drain per minute while active (even off-room). */
    globalOxygenDrainPerMinute: number;
    resolutionHints: string[];
    /** Whether this event type is a persistent local hazard. */
    persistent: boolean;
    /** Systems whose repair can resolve this hazard. */
    resolvableBySystems: string[];
    /** Action tags that can resolve or mitigate this hazard. */
    resolvableByActions: string[];
}

export const EVENT_DEFINITIONS: EventDefinition[] = [
    {
        type: 'hull_breach',
        baseProbability: 0.08,
        cooldownMinutes: 120,
        minElapsedMinutes: 75,
        durationMinutes: [25, 45],
        damagePerMinute: 0.4,
        suitDamagePerMinute: 0.15,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 1,
        effect: 'decompression — HP and suit integrity drain continuously',
        persistent: true,
        resolvableBySystems: ['pressure_seal', 'structural_integrity'],
        resolvableByActions: ['seal', 'patch', 'reinforce'],
        resolutionHints: [
            'Emergency bulkhead auto-sealed after pressure differential equalized',
            'Micrometeorite puncture self-sealed as hull foam expanded into the breach',
            'Station attitude adjustment rotated breach away from solar wind, reducing pressure loss below critical threshold',
        ],
    },
    {
        type: 'power_failure',
        baseProbability: 0.10,
        cooldownMinutes: 90,
        minElapsedMinutes: 45,
        durationMinutes: [20, 40],
        damagePerMinute: 0,
        suitDamagePerMinute: 0,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'station power grid offline — visibility severely limited, instruments dark',
        persistent: false,
        resolvableBySystems: ['power_relay', 'communications'],
        resolvableByActions: ['bypass', 'reroute', 'shed_load'],
        resolutionHints: [
            'Backup capacitor bank reached sufficient charge to restart main bus',
            'Auto-reset relay tripped after thermal cooldown period',
            'Emergency generator fuel cell completed warm-up sequence',
        ],
    },
    {
        type: 'distress_signal',
        baseProbability: 0.06,
        cooldownMinutes: 150,
        minElapsedMinutes: 120,
        durationMinutes: [0, 0],
        damagePerMinute: 0,
        suitDamagePerMinute: 0,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'reveals a hidden room connection',
        persistent: false,
        resolvableBySystems: [],
        resolvableByActions: [],
        resolutionHints: [],
    },
    {
        type: 'radiation_spike',
        baseProbability: 0.07,
        cooldownMinutes: 105,
        minElapsedMinutes: 90,
        durationMinutes: [20, 35],
        damagePerMinute: 0.25,
        suitDamagePerMinute: 0.4,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'radiation exposure — continuous HP and suit degradation',
        persistent: true,
        resolvableBySystems: ['radiation_shielding'],
        resolvableByActions: ['shield', 'isolate', 'reduce_source'],
        resolutionHints: [
            'Solar particle event intensity dropped below shielding threshold',
            'Radiation source half-life decay brought flux below alarm setpoint',
            'Station magnetic deflector recovered enough charge to re-establish field geometry',
        ],
    },
    {
        type: 'supply_cache',
        baseProbability: 0.15,
        cooldownMinutes: 75,
        minElapsedMinutes: 30,
        hpThreshold: 0.4,
        durationMinutes: [0, 0],
        damagePerMinute: 0,
        suitDamagePerMinute: 0,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'emergency supplies appear in room',
        persistent: false,
        resolvableBySystems: [],
        resolvableByActions: [],
        resolutionHints: [],
    },
    {
        type: 'atmosphere_alarm',
        baseProbability: 0.06,
        cooldownMinutes: 120,
        minElapsedMinutes: 60,
        durationMinutes: [25, 45],
        damagePerMinute: 0,
        suitDamagePerMinute: 0,
        oxygenDrainPerMinute: 0.4,
        globalOxygenDrainPerMinute: 1,
        effect: 'atmosphere processor struggling — oxygen draining continuously',
        persistent: true,
        resolvableBySystems: ['life_support', 'atmosphere_processor'],
        resolvableByActions: ['vent', 'reroute', 'isolate'],
        resolutionHints: [
            'Backup CO2 scrubber cartridge auto-engaged after primary saturation',
            'Atmosphere processor thermal reset completed, resuming nominal filtration',
            'Emergency oxygen reserve valve opened on low-ppO2 interlock',
        ],
    },
    {
        type: 'coolant_leak',
        baseProbability: 0.05,
        cooldownMinutes: 105,
        minElapsedMinutes: 75,
        durationMinutes: [20, 35],
        damagePerMinute: 0,
        suitDamagePerMinute: 0,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'coolant on floor — slip hazard, reduced visibility from vapor',
        persistent: true,
        resolvableBySystems: ['coolant_loop', 'thermal_regulator'],
        resolvableByActions: ['vent', 'reroute', 'freeze', 'isolate'],
        resolutionHints: [
            'Coolant loop pressure equalized — leak rate dropped below measurable threshold',
            'Leaked coolant evaporated as ambient temperature rose above its boiling point',
            'Isolation valve upstream of the breach closed on low-pressure interlock',
        ],
    },
    {
        type: 'structural_alert',
        baseProbability: 0.04,
        cooldownMinutes: 150,
        minElapsedMinutes: 105,
        durationMinutes: [20, 35],
        damagePerMinute: 0,
        suitDamagePerMinute: 0.25,
        oxygenDrainPerMinute: 0,
        globalOxygenDrainPerMinute: 0,
        effect: 'structural stress — micro-debris degrading suit integrity continuously',
        persistent: true,
        resolvableBySystems: ['structural_integrity'],
        resolvableByActions: ['reinforce', 'shore_up', 'seal'],
        resolutionHints: [
            'Thermal cycling stress relieved as station entered eclipse — contraction closed micro-fractures',
            'Structural load redistribution completed after adjacent section sealed',
            'Emergency frame reinforcement struts auto-deployed at stress threshold',
        ],
    },
    {
        type: 'fire_outbreak',
        baseProbability: 0.04,
        cooldownMinutes: 90,
        minElapsedMinutes: 60,
        durationMinutes: [15, 30],
        damagePerMinute: 1,
        suitDamagePerMinute: 1,
        oxygenDrainPerMinute: 2,
        globalOxygenDrainPerMinute: 0,
        effect: 'active fire — temperature rising, oxygen being consumed, direct HP and suit damage',
        persistent: true,
        resolvableBySystems: ['fire_suppression'],
        resolvableByActions: ['extinguish', 'starve', 'vent', 'isolate'],
        resolutionHints: [
            'Fire suppression system engaged after temperature exceeded failsafe threshold',
            'Fire consumed available fuel and self-extinguished in the sealed compartment',
            'Emergency atmospheric venting starved the fire of oxygen',
        ],
    },
];

/** Look up an event definition by type. */
export function getEventDefinition(type: EventType): EventDefinition | undefined {
    return EVENT_DEFINITIONS.find(d => d.type === type);
}

// ─── Event Tracker ──────────────────────────────────────────────────────────

export class EventTracker {
    lastTriggered: Map<EventType, number> = new Map();

    /**
     * Director-driven hazard spawning. Uses the hazard director to score
     * candidates and select a state-valid event, then assigns it to a room.
     */
    checkRandomEvent(
        state: GameState,
        station?: GeneratedStation,
    ): ActiveEvent | null {
        // If station is provided, use the director for state-aware spawning
        if (station) {
            return this.checkDirectorEvent(state, station);
        }

        // Legacy fallback: stateless random selection (for backward compatibility)
        return this.checkLegacyRandomEvent(state);
    }

    private checkDirectorEvent(state: GameState, station: GeneratedStation): ActiveEvent | null {
        const snapshot = buildStationPressureSnapshot(state, station);
        const decision = computeHazardDirectorDecision(snapshot, state, station);

        if (!decision.shouldSpawn || decision.candidates.length === 0) return null;

        // Also check basic cooldowns
        const elapsed = state.missionElapsedMinutes;

        // Try candidates in order of weight
        for (const candidate of decision.candidates) {
            const def = EVENT_DEFINITIONS.find(d => d.type === candidate.type);
            if (!def) continue;

            if (elapsed < def.minElapsedMinutes) continue;

            const lastTime = this.lastTriggered.get(def.type);
            if (lastTime !== undefined && elapsed - lastTime < def.cooldownMinutes) continue;

            if (def.hpThreshold !== undefined) {
                const hpPct = state.hp / state.maxHp;
                if (hpPct > def.hpThreshold) continue;
            }

            // Per-room dedup for persistent hazards
            if (def.persistent && candidate.preferredRoomId) {
                if (state.activeEvents.some(e => e.type === def.type && e.roomId === candidate.preferredRoomId)) {
                    continue;
                }
            }

            // Select this candidate
            this.lastTriggered.set(def.type, elapsed);

            const [minDur, maxDur] = def.durationMinutes;
            const duration = minDur === maxDur ? minDur
                : minDur + Math.floor(Math.random() * (maxDur - minDur + 1));

            const hint = def.resolutionHints.length > 0
                ? def.resolutionHints[Math.floor(Math.random() * def.resolutionHints.length)]
                : '';

            const roomId = candidate.preferredRoomId ?? state.currentRoom;

            return {
                type: def.type,
                description: def.effect,
                minutesRemaining: duration,
                effect: def.effect,
                resolutionHint: hint,
                roomId: def.persistent ? roomId : undefined,
                severity: deriveSeverity(def, snapshot.pressurePhase === 'crescendo'),
            };
        }

        return null;
    }

    /** Legacy stateless random event selection for backward compatibility. */
    private checkLegacyRandomEvent(state: GameState): ActiveEvent | null {
        const elapsed = state.missionElapsedMinutes;

        for (const def of EVENT_DEFINITIONS) {
            if (elapsed < def.minElapsedMinutes) continue;

            const lastTime = this.lastTriggered.get(def.type);
            if (lastTime !== undefined && elapsed - lastTime < def.cooldownMinutes) continue;

            if (def.hpThreshold !== undefined) {
                const hpPct = state.hp / state.maxHp;
                if (hpPct > def.hpThreshold) continue;
            }

            if (state.activeEvents.some(e => e.type === def.type)) continue;

            const tensionModifier = elapsed / 500;
            const probability = def.baseProbability + tensionModifier;

            if (Math.random() < probability) {
                this.lastTriggered.set(def.type, elapsed);

                const [minDur, maxDur] = def.durationMinutes;
                const duration = minDur === maxDur ? minDur
                    : minDur + Math.floor(Math.random() * (maxDur - minDur + 1));

                const hint = def.resolutionHints.length > 0
                    ? def.resolutionHints[Math.floor(Math.random() * def.resolutionHints.length)]
                    : '';

                return {
                    type: def.type,
                    description: def.effect,
                    minutesRemaining: duration,
                    effect: def.effect,
                    resolutionHint: hint,
                };
            }
        }

        return null;
    }

    /**
     * Tick active events: apply damage only when the player is in the hazard's room
     * (or if the event has no roomId for backward compat). Apply global drain always.
     */
    tickActiveEvents(state: GameState, elapsedMinutes: number): string[] {
        const context: string[] = [];
        const remaining: ActiveEvent[] = [];

        for (const event of state.activeEvents) {
            const def = EVENT_DEFINITIONS.find(d => d.type === event.type);
            if (!def) {
                remaining.push(event);
                continue;
            }

            const effectiveMinutes = Math.min(elapsedMinutes, event.minutesRemaining);

            // Determine if player is in this hazard's room
            const isInRoom = !event.roomId || event.roomId === state.currentRoom;

            // Local damage only applies when player is in the room
            if (isInRoom) {
                const hpDmg = Math.round(def.damagePerMinute * effectiveMinutes);
                const suitDmg = Math.round(def.suitDamagePerMinute * effectiveMinutes);
                const o2Drain = Math.round(def.oxygenDrainPerMinute * effectiveMinutes);

                if (hpDmg > 0) {
                    state.hp = Math.max(0, state.hp - hpDmg);
                    state.metrics.totalDamageTaken += hpDmg;
                }
                if (suitDmg > 0) {
                    state.suitIntegrity = Math.max(0, state.suitIntegrity - suitDmg);
                }
                if (o2Drain > 0) {
                    state.oxygen = Math.max(0, state.oxygen - o2Drain);
                }

                // Context messages for in-room effects
                const roomLabel = event.roomId
                    ? ` [${event.roomId}]`
                    : '';
                if (event.type === 'hull_breach' && (hpDmg > 0 || suitDmg > 0)) {
                    context.push(`HULL BREACH${roomLabel}: Decompression damage — ${String(hpDmg)} HP, suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
                }
                if (event.type === 'power_failure') {
                    context.push(`POWER FAILURE${roomLabel}: Station systems offline — visibility severely limited.`);
                }
                if (event.type === 'radiation_spike' && (hpDmg > 0 || suitDmg > 0)) {
                    context.push(`RADIATION SPIKE${roomLabel}: ${String(hpDmg)} HP radiation damage, suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
                }
                if (event.type === 'atmosphere_alarm' && o2Drain > 0) {
                    context.push(`ATMOSPHERE ALARM${roomLabel}: Oxygen depleted by ${String(o2Drain)} over ${String(effectiveMinutes)} min.`);
                }
                if (event.type === 'coolant_leak') {
                    context.push(`COOLANT LEAK${roomLabel}: Floor slick with coolant — creative actions penalized.`);
                }
                if (event.type === 'structural_alert' && suitDmg > 0) {
                    context.push(`STRUCTURAL ALERT${roomLabel}: Micro-debris — suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
                }
                if (event.type === 'fire_outbreak') {
                    context.push(`FIRE OUTBREAK${roomLabel}: Active fire — ${String(hpDmg)} HP, suit -${String(suitDmg)}, oxygen -${String(o2Drain)} over ${String(effectiveMinutes)} min.`);
                }
            }

            // Global drain always applies: the hazard depletes the whole station's atmosphere.
            if (def.globalOxygenDrainPerMinute > 0) {
                const globalDrain = Math.round(def.globalOxygenDrainPerMinute * effectiveMinutes);
                if (globalDrain > 0) {
                    state.oxygen = Math.max(0, state.oxygen - globalDrain);
                    const roomLabel = event.roomId ? ` in ${event.roomId}` : '';
                    context.push(`${event.type.replace(/_/g, ' ').toUpperCase()}${roomLabel}: Station oxygen reserve draining — -${String(globalDrain)} O₂ over ${String(effectiveMinutes)} min.`);
                }
            }

            // Check death conditions
            if (state.hp <= 0) {
                state.gameOver = true;
                state.metrics.deathCause = `Killed by ${event.type.replace(/_/g, ' ')}`;
            }
            if (state.oxygen <= 0) {
                state.gameOver = true;
                state.metrics.deathCause = 'Asphyxiation — oxygen depleted';
            }
            if (state.suitIntegrity <= 0) {
                state.gameOver = true;
                state.metrics.deathCause = 'Suit failure — integrity compromised';
            }

            event.minutesRemaining -= elapsedMinutes;
            if (event.minutesRemaining > 0) {
                remaining.push(event);
            } else {
                context.push(`Event resolved: ${event.type.replace(/_/g, ' ')}. ${event.resolutionHint}`);
            }
        }

        state.activeEvents = remaining;
        return context;
    }

    processCascadeEffects(state: GameState, station: GeneratedStation, elapsedMinutes: number): string[] {
        const context: string[] = [];

        for (const [roomId, room] of station.rooms) {
            for (const failure of room.systemFailures) {
                if (failure.challengeState === 'resolved') continue;

                // Apply proportional hazard if player is in the room
                // Post-cascade: fully failed systems continue to harm occupants
                if (roomId === state.currentRoom && failure.hazardPerMinute > 0) {
                    const hazardDmg = Math.round(failure.hazardPerMinute * elapsedMinutes);
                    if (hazardDmg > 0) {
                        state.hp = Math.max(0, state.hp - hazardDmg);
                        state.metrics.totalDamageTaken += hazardDmg;
                        context.push(`HAZARD: ${failure.systemId.replace(/_/g, ' ')} failure dealing ${String(hazardDmg)} damage over ${String(elapsedMinutes)} min.`);
                    }
                }

                // Skip already-failed systems for cascade logic
                if (failure.challengeState === 'failed') continue;
                const hasActiveOrExpiredCascadeTimer = failure.minutesUntilCascade > 0 || failure.severity >= 2;
                if (!hasActiveOrExpiredCascadeTimer) continue;

                // Cascade when timer expires
                if (failure.minutesUntilCascade <= 0) {
                    failure.challengeState = 'failed';
                    failure.status = 'offline';
                    state.systemsCascaded++;
                    state.metrics.systemsCascaded++;
                    context.push(`CASCADE: ${failure.systemId.replace(/_/g, ' ')} in ${room.name} has failed completely!`);

                    // Propagate to target room
                    if (failure.cascadeTarget) {
                        const targetRoom = station.rooms.get(failure.cascadeTarget);
                        if (targetRoom) {
                            const newSeverity = Math.min(3, failure.severity + 1) as 1 | 2 | 3;
                            targetRoom.systemFailures.push({
                                systemId: failure.systemId,
                                status: newSeverity >= 3 ? 'critical' : 'failing',
                                failureMode: failure.failureMode,
                                severity: newSeverity,
                                challengeState: 'detected',
                                requiredMaterials: [...failure.requiredMaterials],
                                requiredSkill: failure.requiredSkill,
                                difficulty: failure.difficulty,
                                minutesUntilCascade: Math.max(30, failure.severity === 3 ? 30 : 45),
                                cascadeTarget: null,
                                hazardPerMinute: failure.hazardPerMinute + 0.2,
                                diagnosisHint: `Cascaded from ${room.name}: ${failure.diagnosisHint}`,
                                technicalDetail: '',
                                mitigationPaths: [...failure.mitigationPaths],
                            });
                            context.push(`WARNING: ${failure.systemId.replace(/_/g, ' ')} failure has propagated to ${targetRoom.name}!`);
                        }
                    }
                }

                // Check death conditions
                if (state.hp <= 0) {
                    state.gameOver = true;
                    state.metrics.deathCause = `System hazard: ${failure.systemId}`;
                }
            }
        }

        return context;
    }
}

// ─── Hazard Resolution Helpers ──────────────────────────────────────────────

/**
 * Check if repairing a system should resolve any active hazards in the room.
 * Returns the resolved events for context messaging.
 */
export function resolveHazardsByRepair(
    state: GameState,
    roomId: string,
    systemId: string,
): ActiveEvent[] {
    const resolved: ActiveEvent[] = [];
    const remaining: ActiveEvent[] = [];

    for (const event of state.activeEvents) {
        const def = EVENT_DEFINITIONS.find(d => d.type === event.type);
        if (
            def &&
            event.roomId === roomId &&
            def.resolvableBySystems.includes(systemId)
        ) {
            resolved.push(event);
        } else {
            remaining.push(event);
        }
    }

    state.activeEvents = remaining;
    return resolved;
}

/**
 * Check if an action matches a hazard's resolution tags. Returns resolved or
 * downgraded events. For stabilize_hazard, downgrade severity instead of clearing.
 */
export function resolveHazardsByAction(
    state: GameState,
    roomId: string,
    actionDescription: string,
    isStabilize: boolean,
): ActiveEvent[] {
    const actionLower = actionDescription.toLowerCase();
    const resolved: ActiveEvent[] = [];
    const remaining: ActiveEvent[] = [];

    for (const event of state.activeEvents) {
        const def = EVENT_DEFINITIONS.find(d => d.type === event.type);
        if (!def || event.roomId !== roomId) {
            remaining.push(event);
            continue;
        }

        const matches = def.resolvableByActions.some(tag => actionLower.includes(tag));
        if (!matches) {
            remaining.push(event);
            continue;
        }

        if (isStabilize) {
            // Stabilize: reduce severity instead of clearing
            if (event.severity === 'critical') {
                event.severity = 'major';
                event.minutesRemaining = Math.max(event.minutesRemaining, 15);
                remaining.push(event);
            } else if (event.severity === 'major') {
                event.severity = 'minor';
                event.minutesRemaining = Math.max(event.minutesRemaining, 10);
                remaining.push(event);
            } else {
                // Minor severity: stabilize fully resolves
                resolved.push(event);
            }
        } else {
            // Full resolution
            resolved.push(event);
        }
    }

    state.activeEvents = remaining;
    return resolved;
}

/**
 * Check if using an item resolves a hazard in the current room.
 * Matches item IDs against system failure templates' required materials.
 */
export function resolveHazardsByItem(
    state: GameState,
    roomId: string,
    itemId: string,
): ActiveEvent[] {
    // Map items to hazard-resolution relevance
    const ITEM_HAZARD_MAP: Record<string, EventType[]> = {
        sealant_patch: ['hull_breach', 'atmosphere_alarm'],
        structural_epoxy: ['structural_alert', 'hull_breach'],
        coolant_canister: ['coolant_leak', 'fire_outbreak'],
        bio_filter: ['atmosphere_alarm'],
        neutralizer_agent: ['atmosphere_alarm'],
        replacement_valve: ['coolant_leak'],
    };

    const matchingTypes = ITEM_HAZARD_MAP[itemId] ?? [];
    if (matchingTypes.length === 0) return [];

    const resolved: ActiveEvent[] = [];
    const remaining: ActiveEvent[] = [];

    for (const event of state.activeEvents) {
        if (event.roomId === roomId && matchingTypes.includes(event.type)) {
            resolved.push(event);
        } else {
            remaining.push(event);
        }
    }

    state.activeEvents = remaining;
    return resolved;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deriveSeverity(def: EventDefinition, isCrescendo: boolean): HazardSeverity {
    if (isCrescendo) return 'critical';
    if (def.damagePerMinute >= 0.5 || def.suitDamagePerMinute >= 0.4) return 'major';
    return 'minor';
}

// ─── Cascade Countdown (standalone, called incrementally as tools consume time) ──

export function advanceCascadeCountdowns(station: GeneratedStation, minutes: number): void {
    for (const room of station.rooms.values()) {
        for (const failure of room.systemFailures) {
            if (failure.challengeState === 'resolved' || failure.challengeState === 'failed') continue;
            if (failure.minutesUntilCascade <= 0) continue;
            const effective = failure.challengeState === 'stabilized' ? minutes / 2 : minutes;
            failure.minutesUntilCascade -= effective;
        }
    }
}

// ─── Prompt Context Helper ──────────────────────────────────────────────────

export function getEventContext(events: ActiveEvent[]): string {
    if (events.length === 0) return '';

    const lines = events.map(e => {
        const hint = e.resolutionHint
            ? ` Recovery mechanism: ${e.resolutionHint.charAt(0).toLowerCase()}${e.resolutionHint.slice(1)}.`
            : '';
        const location = e.roomId ? ` [${e.roomId}]` : '';
        const severity = e.severity ? ` severity=${e.severity}` : '';
        return `- **${e.type.replace(/_/g, ' ').toUpperCase()}**${location} (${String(e.minutesRemaining)} min remaining${severity}): ${e.effect}.${hint}`;
    });

    return `## Active Station Events\n${lines.join('\n')}`;
}
