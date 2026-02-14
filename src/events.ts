import type { GameState, EventType, ActiveEvent, GeneratedStation } from './types.js';

// ─── Event Definitions ──────────────────────────────────────────────────────

export interface EventDefinition {
    type: EventType;
    baseProbability: number;
    cooldownMinutes: number;
    minElapsedMinutes: number;
    hpThreshold?: number;
    effect: string;
    durationMinutes: [number, number];
    damagePerMinute: number;
    suitDamagePerMinute: number;
    oxygenDrainPerMinute: number;
    resolutionHints: string[];
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
        effect: 'decompression — HP and suit integrity drain continuously',
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
        effect: 'station power grid offline — visibility severely limited, instruments dark',
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
        effect: 'reveals a hidden room connection',
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
        effect: 'radiation exposure — continuous HP and suit degradation',
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
        effect: 'emergency supplies appear in room',
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
        effect: 'atmosphere processor struggling — oxygen draining continuously',
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
        effect: 'coolant on floor — slip hazard, reduced visibility from vapor',
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
        effect: 'structural stress — micro-debris degrading suit integrity continuously',
        resolutionHints: [
            'Thermal cycling stress relieved as station entered eclipse — contraction closed micro-fractures',
            'Structural load redistribution completed after adjacent section sealed',
            'Emergency frame reinforcement struts auto-deployed at stress threshold',
        ],
    },
];

// ─── Event Tracker ──────────────────────────────────────────────────────────

export class EventTracker {
    lastTriggered: Map<EventType, number> = new Map();

    checkRandomEvent(state: GameState): ActiveEvent | null {
        const elapsed = state.missionElapsedMinutes;

        for (const def of EVENT_DEFINITIONS) {
            if (elapsed < def.minElapsedMinutes) continue;

            const lastTime = this.lastTriggered.get(def.type);
            if (lastTime !== undefined && elapsed - lastTime < def.cooldownMinutes) continue;

            if (def.hpThreshold !== undefined) {
                const hpPct = state.hp / state.maxHp;
                if (hpPct > def.hpThreshold) continue;
            }

            // Already have an active event of this type
            if (state.activeEvents.some(e => e.type === def.type)) continue;

            const tensionModifier = elapsed / 500;
            const probability = def.baseProbability + tensionModifier;

            if (Math.random() < probability) {
                this.lastTriggered.set(def.type, elapsed);

                // Randomize duration within range
                const [minDur, maxDur] = def.durationMinutes;
                const duration = minDur === maxDur ? minDur
                    : minDur + Math.floor(Math.random() * (maxDur - minDur + 1));

                // Pick a random resolution hint
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

    tickActiveEvents(state: GameState, elapsedMinutes: number): string[] {
        const context: string[] = [];
        const remaining: ActiveEvent[] = [];

        for (const event of state.activeEvents) {
            const def = EVENT_DEFINITIONS.find(d => d.type === event.type);
            if (!def) {
                remaining.push(event);
                continue;
            }

            // Only apply damage for the time this event is actually active
            const effectiveMinutes = Math.min(elapsedMinutes, event.minutesRemaining);

            // Proportional damage
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

            // Context messages for ongoing effects
            if (event.type === 'hull_breach' && (hpDmg > 0 || suitDmg > 0)) {
                context.push(`HULL BREACH: Decompression damage — ${String(hpDmg)} HP, suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
            }
            if (event.type === 'power_failure') {
                context.push('POWER FAILURE: Station systems offline — visibility severely limited.');
            }
            if (event.type === 'radiation_spike' && (hpDmg > 0 || suitDmg > 0)) {
                context.push(`RADIATION SPIKE: ${String(hpDmg)} HP radiation damage, suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
            }
            if (event.type === 'atmosphere_alarm' && o2Drain > 0) {
                context.push(`ATMOSPHERE ALARM: Oxygen depleted by ${String(o2Drain)} over ${String(effectiveMinutes)} min.`);
            }
            if (event.type === 'coolant_leak') {
                context.push('COOLANT LEAK: Floor slick with coolant — creative actions penalized.');
            }
            if (event.type === 'structural_alert' && suitDmg > 0) {
                context.push(`STRUCTURAL ALERT: Micro-debris — suit integrity -${String(suitDmg)} over ${String(effectiveMinutes)} min.`);
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

    tickCascadeTimers(state: GameState, station: GeneratedStation, elapsedMinutes: number): string[] {
        const context: string[] = [];

        for (const [roomId, room] of station.rooms) {
            for (const failure of room.systemFailures) {
                // Skip resolved or already-failed failures
                if (failure.challengeState === 'resolved' || failure.challengeState === 'failed') continue;
                // Skip failures with no cascade timer
                if (failure.minutesUntilCascade <= 0) continue;

                // Stabilized failures tick at half rate
                const effectiveElapsed = failure.challengeState === 'stabilized'
                    ? elapsedMinutes / 2
                    : elapsedMinutes;

                failure.minutesUntilCascade -= effectiveElapsed;

                // Apply proportional hazard if player is in the room
                if (roomId === state.currentRoom && failure.hazardPerMinute > 0) {
                    const hazardDmg = Math.round(failure.hazardPerMinute * elapsedMinutes);
                    if (hazardDmg > 0) {
                        state.hp = Math.max(0, state.hp - hazardDmg);
                        state.metrics.totalDamageTaken += hazardDmg;
                        context.push(`HAZARD: ${failure.systemId.replace(/_/g, ' ')} failure dealing ${String(hazardDmg)} damage over ${String(elapsedMinutes)} min.`);
                    }
                }

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

// ─── Prompt Context Helper ──────────────────────────────────────────────────

export function getEventContext(events: ActiveEvent[]): string {
    if (events.length === 0) return '';

    const lines = events.map(e => {
        const hint = e.resolutionHint
            ? ` Recovery mechanism: ${e.resolutionHint.charAt(0).toLowerCase()}${e.resolutionHint.slice(1)}.`
            : '';
        return `- **${e.type.replace(/_/g, ' ').toUpperCase()}** (${String(e.minutesRemaining)} min remaining): ${e.effect}.${hint}`;
    });

    return `## Active Station Events\n${lines.join('\n')}`;
}
