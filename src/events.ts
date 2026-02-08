import type { GameState, EventType, ActiveEvent } from './types.js';

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
        effect: 'lose 5 HP per turn (decompression)',
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
        effect: 'combat damage reduced by 25%',
    },
    {
        type: 'supply_cache',
        baseProbability: 0.15,
        cooldown: 5,
        minTurn: 2,
        hpThreshold: 0.4,
        duration: 0,
        effect: 'free medkit added to room',
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
                context.push('HULL BREACH: You lose 5 HP from decompression damage.');
            }

            if (event.type === 'power_failure') {
                context.push('POWER FAILURE: Station systems are offline — visibility severely limited.');
            }

            if (event.type === 'radiation_spike') {
                context.push('RADIATION SPIKE: High radiation levels reduce combat effectiveness by 25%.');
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
}

// ─── Prompt Context Helper ──────────────────────────────────────────────────

export function getEventContext(events: ActiveEvent[]): string {
    if (events.length === 0) return '';

    const lines = events.map(e =>
        `- **${e.type.replace(/_/g, ' ').toUpperCase()}** (${String(e.turnsRemaining)} turns remaining): ${e.effect}`
    );

    return `## Active Station Events\n${lines.join('\n')}`;
}
