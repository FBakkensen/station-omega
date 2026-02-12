import type { GameState, EventType, ActiveEvent, GeneratedStation } from './types.js';

// ─── Event Definitions ──────────────────────────────────────────────────────

export interface EventDefinition {
    type: EventType;
    baseProbability: number;
    cooldown: number;
    minTurn: number;
    hpThreshold?: number;
    effect: string;
    duration: number;
}

export const EVENT_DEFINITIONS: EventDefinition[] = [
    {
        type: 'hull_breach',
        baseProbability: 0.08,
        cooldown: 8,
        minTurn: 5,
        duration: 3,
        effect: 'lose 5 HP and 2 suit integrity per turn (decompression)',
    },
    {
        type: 'power_failure',
        baseProbability: 0.10,
        cooldown: 6,
        minTurn: 3,
        duration: 2,
        effect: 'look_around returns limited info',
    },
    {
        type: 'distress_signal',
        baseProbability: 0.06,
        cooldown: 10,
        minTurn: 8,
        duration: 0,
        effect: 'reveals a hidden room connection',
    },
    {
        type: 'radiation_spike',
        baseProbability: 0.07,
        cooldown: 7,
        minTurn: 6,
        duration: 2,
        effect: 'radiation exposure — 3 HP/turn, suit integrity -5/turn',
    },
    {
        type: 'supply_cache',
        baseProbability: 0.15,
        cooldown: 5,
        minTurn: 2,
        hpThreshold: 0.4,
        duration: 0,
        effect: 'emergency supplies appear in room',
    },
    {
        type: 'atmosphere_alarm',
        baseProbability: 0.06,
        cooldown: 8,
        minTurn: 4,
        duration: 3,
        effect: 'atmosphere processor struggling — oxygen consumption doubled',
    },
    {
        type: 'coolant_leak',
        baseProbability: 0.05,
        cooldown: 7,
        minTurn: 5,
        duration: 2,
        effect: 'coolant on floor — slip hazard, creative actions -10',
    },
    {
        type: 'structural_alert',
        baseProbability: 0.04,
        cooldown: 10,
        minTurn: 7,
        duration: 2,
        effect: 'structural stress detected — suit integrity -3/turn',
    },
];

// ─── Event Tracker ──────────────────────────────────────────────────────────

export class EventTracker {
    lastTriggered: Map<EventType, number> = new Map();

    checkRandomEvent(state: GameState): ActiveEvent | null {
        const turn = state.turnCount;

        for (const def of EVENT_DEFINITIONS) {
            if (turn < def.minTurn) continue;

            const lastTurn = this.lastTriggered.get(def.type);
            if (lastTurn !== undefined && turn - lastTurn < def.cooldown) continue;

            if (def.hpThreshold !== undefined) {
                const hpPct = state.hp / state.maxHp;
                if (hpPct > def.hpThreshold) continue;
            }

            // Already have an active event of this type
            if (state.activeEvents.some(e => e.type === def.type)) continue;

            const tensionModifier = turn / 50;
            const probability = def.baseProbability + tensionModifier;

            if (Math.random() < probability) {
                this.lastTriggered.set(def.type, turn);
                return {
                    type: def.type,
                    description: def.effect,
                    turnsRemaining: def.duration,
                    effect: def.effect,
                };
            }
        }

        return null;
    }

    tickActiveEvents(state: GameState): string[] {
        const context: string[] = [];
        const remaining: ActiveEvent[] = [];

        for (const event of state.activeEvents) {
            // Apply per-turn effects
            if (event.type === 'hull_breach') {
                state.hp = Math.max(0, state.hp - 5);
                state.suitIntegrity = Math.max(0, state.suitIntegrity - 2);
                context.push('HULL BREACH: Decompression damage — 5 HP, suit integrity -2.');
            }

            if (event.type === 'power_failure') {
                context.push('POWER FAILURE: Station systems offline — visibility severely limited.');
            }

            if (event.type === 'radiation_spike') {
                state.hp = Math.max(0, state.hp - 3);
                state.suitIntegrity = Math.max(0, state.suitIntegrity - 5);
                state.metrics.totalDamageTaken += 3;
                context.push('RADIATION SPIKE: 3 HP radiation damage, suit integrity -5.');
            }

            if (event.type === 'atmosphere_alarm') {
                state.oxygen = Math.max(0, state.oxygen - 5);
                context.push('ATMOSPHERE ALARM: Oxygen consumption doubled — O2 dropping fast.');
            }

            if (event.type === 'coolant_leak') {
                context.push('COOLANT LEAK: Floor slick with coolant — creative actions penalized.');
            }

            if (event.type === 'structural_alert') {
                state.suitIntegrity = Math.max(0, state.suitIntegrity - 3);
                context.push('STRUCTURAL ALERT: Micro-debris — suit integrity -3.');
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

            event.turnsRemaining--;
            if (event.turnsRemaining > 0) {
                remaining.push(event);
            } else {
                context.push(`Event ended: ${event.type.replace(/_/g, ' ')}.`);
            }
        }

        state.activeEvents = remaining;
        return context;
    }

    tickCascadeTimers(state: GameState, station: GeneratedStation): string[] {
        const context: string[] = [];

        for (const [roomId, room] of station.rooms) {
            for (const failure of room.systemFailures) {
                // Skip resolved or already-failed failures
                if (failure.challengeState === 'resolved' || failure.challengeState === 'failed') continue;
                // Skip failures with no cascade timer
                if (failure.turnsUntilCascade <= 0) continue;

                // Stabilized failures tick at half speed (only on even turns)
                if (failure.challengeState === 'stabilized' && state.turnCount % 2 !== 0) continue;

                failure.turnsUntilCascade--;

                // Apply per-turn hazard if player is in the room
                if (roomId === state.currentRoom && failure.hazardPerTurn > 0) {
                    state.hp = Math.max(0, state.hp - failure.hazardPerTurn);
                    state.metrics.totalDamageTaken += failure.hazardPerTurn;
                    context.push(`HAZARD: ${failure.systemId.replace(/_/g, ' ')} failure dealing ${String(failure.hazardPerTurn)} damage.`);
                }

                // Cascade when timer expires
                if (failure.turnsUntilCascade <= 0) {
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
                                turnsUntilCascade: Math.max(3, failure.severity === 3 ? 3 : 5),
                                cascadeTarget: null,
                                hazardPerTurn: failure.hazardPerTurn + 2,
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

    const lines = events.map(e =>
        `- **${e.type.replace(/_/g, ' ').toUpperCase()}** (${String(e.turnsRemaining)} turns remaining): ${e.effect}`
    );

    return `## Active Station Events\n${lines.join('\n')}`;
}
