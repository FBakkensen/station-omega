import type { Room, ActiveEvent, GameState } from './types.js';

// ─── Environment Snapshot ────────────────────────────────────────────────────

export interface EnvironmentSnapshot {
    oxygenPct: number;           // 14-21
    co2Ppm: number;              // 400-4600
    pressureKpa: number;         // 60-101
    temperatureC: number;        // 5-53
    radiationMsv: number;        // 0.1-13+
    structuralPct: number;       // 40-98
    gravityG: number;            // 0.6 or 1.0
    powerStatus: 'nominal' | 'intermittent';
    // Derived
    ppO2: number;
    hypoxiaRisk: 'nominal' | 'warning' | 'critical';
    activeFailureCount: number;
}

export type TrendDirection = 'rising' | 'falling' | 'stable';

export interface EnvironmentReadout {
    snapshot: EnvironmentSnapshot;
    trends: Record<
        'oxygenPct' | 'co2Ppm' | 'pressureKpa' | 'temperatureC' | 'radiationMsv' | 'structuralPct',
        TrendDirection
    >;
}

// ─── Compute Environment ─────────────────────────────────────────────────────

/** Compute environment snapshot from room system failures + active events. */
export function computeEnvironment(
    room: Room,
    activeEvents: readonly ActiveEvent[],
): EnvironmentSnapshot {
    const failures = room.systemFailures.filter(f => f.challengeState !== 'resolved');

    const hasAtmo = failures.some(f => f.systemId === 'atmosphere_processor' || f.systemId === 'life_support');
    const hasPressure = failures.some(f => f.systemId === 'pressure_seal');
    const hasRad = failures.some(f => f.systemId === 'radiation_shielding');
    const hasThermal = failures.some(f => f.systemId === 'thermal_regulator' || f.systemId === 'coolant_loop');
    const hasStructural = failures.some(f => f.systemId === 'structural_integrity');

    const atmoFailureCount = failures.filter(f => f.systemId === 'atmosphere_processor' || f.systemId === 'life_support').length;
    const lifeSupportFailureCount = failures.filter(f => f.systemId === 'life_support').length;
    const pressureFailureCount = failures.filter(f => f.systemId === 'pressure_seal').length;
    const thermalFailureCount = failures.filter(f => f.systemId === 'thermal_regulator' || f.systemId === 'coolant_loop').length;
    const radFailureCount = failures.filter(f => f.systemId === 'radiation_shielding').length;
    const structuralFailureCount = failures.filter(f => f.systemId === 'structural_integrity').length;

    // Base values from system failures (same formulas as original check_environment)
    let oxygenPct = hasAtmo ? Math.max(14, 21 - atmoFailureCount * 3) : 21;
    let co2Ppm = hasAtmo ? 2200 + lifeSupportFailureCount * 800 : 400;
    let pressureKpa = hasPressure ? 85 - pressureFailureCount * 8 : 101;
    let temperatureC = hasThermal ? 38 + thermalFailureCount * 5 : 22;
    let radiationMsv = hasRad ? 2.5 + radFailureCount * 3.5 : 0.1;
    const structuralPct = hasStructural ? 70 - structuralFailureCount * 15 : 98;

    // Active event modifiers (only apply events localized to this room or global/legacy events)
    for (const event of activeEvents) {
        switch (event.type) {
            case 'hull_breach':
                pressureKpa = Math.max(60, pressureKpa - 15);
                temperatureC -= 8;
                break;
            case 'atmosphere_alarm':
                oxygenPct = Math.max(14, oxygenPct - 4);
                co2Ppm += 1500;
                break;
            case 'radiation_spike':
                radiationMsv += 8;
                break;
            case 'coolant_leak':
                temperatureC += 6;
                break;
            case 'fire_outbreak':
                temperatureC += 12;
                oxygenPct = Math.max(14, oxygenPct - 3);
                break;
        }
    }

    const gravityG = failures.some(f => f.systemId === 'gravity_generator') ? 0.6 : 1.0;
    const powerStatus = failures.some(f => f.systemId === 'power_relay') ? 'intermittent' as const : 'nominal' as const;

    const ppO2 = Math.round(oxygenPct / 100 * pressureKpa * 10) / 10;
    const hypoxiaRisk: 'nominal' | 'warning' | 'critical' =
        ppO2 < 12 ? 'critical' : ppO2 < 16 ? 'warning' : 'nominal';

    return {
        oxygenPct,
        co2Ppm,
        pressureKpa,
        temperatureC,
        radiationMsv,
        structuralPct,
        gravityG,
        powerStatus,
        ppO2,
        hypoxiaRisk,
        activeFailureCount: failures.length,
    };
}

// ─── Environment Damage Tick ─────────────────────────────────────────────────

export interface EnvironmentDamageResult {
    hpDamage: number;
    suitDamage: number;
    oxygenDrain: number;
    messages: string[];
}

/**
 * Apply environment-based damage to the player based on the current-room snapshot.
 * Called each tick alongside event and cascade processing.
 *
 * Threshold rules:
 * - ppO2 12.0-15.9 kPa: +1 O₂ drain per minute
 * - ppO2 < 12.0 kPa: +1 O₂ drain + HP loss when suit compromised (1/min at <50%, 2/min at 0%)
 * - pressure < 85 kPa: 1 suit/min, escalating to 2/min below 70 kPa
 * - pressure with suit=0: 2 HP/min below 85 kPa, 3 HP/min below 70 kPa
 * - temp >= 38°C or <= 10°C: 1 suit/min
 * - temp >= 45°C or <= 4°C: +1 HP/min on top of suit damage
 */
export function tickEnvironmentDamage(
    state: GameState,
    snapshot: EnvironmentSnapshot,
    elapsedMinutes: number,
): EnvironmentDamageResult {
    let hpDamage = 0;
    let suitDamage = 0;
    let oxygenDrain = 0;
    const messages: string[] = [];

    // ── Hypoxia (ppO2) ──
    if (snapshot.ppO2 < 16) {
        // Accelerated oxygen drain in warning/critical zone
        const o2 = Math.round(1 * elapsedMinutes);
        oxygenDrain += o2;

        if (snapshot.ppO2 < 12) {
            // Critical hypoxia: HP loss if suit is compromised
            if (state.suitIntegrity <= 0) {
                const hp = Math.round(2 * elapsedMinutes);
                hpDamage += hp;
                messages.push(`HYPOXIA CRITICAL: ppO₂ ${snapshot.ppO2.toFixed(1)} kPa, suit breached — ${String(hp)} HP damage over ${String(elapsedMinutes)} min.`);
            } else if (state.suitIntegrity < 50) {
                const hp = Math.round(1 * elapsedMinutes);
                hpDamage += hp;
                messages.push(`HYPOXIA CRITICAL: ppO₂ ${snapshot.ppO2.toFixed(1)} kPa, suit degraded — ${String(hp)} HP damage over ${String(elapsedMinutes)} min.`);
            } else {
                messages.push(`HYPOXIA WARNING: ppO₂ ${snapshot.ppO2.toFixed(1)} kPa — accelerated oxygen drain.`);
            }
        } else {
            messages.push(`HYPOXIA WARNING: ppO₂ ${snapshot.ppO2.toFixed(1)} kPa — oxygen drain accelerating.`);
        }
    }

    // ── Decompression (pressure) ──
    if (snapshot.pressureKpa < 85) {
        if (state.suitIntegrity <= 0) {
            // Suit breached: direct HP damage
            const rate = snapshot.pressureKpa < 70 ? 3 : 2;
            const hp = Math.round(rate * elapsedMinutes);
            hpDamage += hp;
            messages.push(`DECOMPRESSION: ${snapshot.pressureKpa.toFixed(1)} kPa, suit breached — ${String(hp)} HP damage over ${String(elapsedMinutes)} min.`);
        } else {
            // Suit absorbs decompression stress
            const rate = snapshot.pressureKpa < 70 ? 2 : 1;
            const suit = Math.round(rate * elapsedMinutes);
            suitDamage += suit;
            messages.push(`DECOMPRESSION: ${snapshot.pressureKpa.toFixed(1)} kPa — suit integrity -${String(suit)} over ${String(elapsedMinutes)} min.`);
        }
    }

    // ── Temperature extremes ──
    const isHot = snapshot.temperatureC >= 38;
    const isCold = snapshot.temperatureC <= 10;
    const isExtremeHot = snapshot.temperatureC >= 45;
    const isExtremeCold = snapshot.temperatureC <= 4;

    if (isHot || isCold) {
        const suit = Math.round(1 * elapsedMinutes);
        suitDamage += suit;

        if (isExtremeHot || isExtremeCold) {
            const hp = Math.round(1 * elapsedMinutes);
            hpDamage += hp;
            const label = isExtremeHot ? 'EXTREME HEAT' : 'EXTREME COLD';
            messages.push(`${label}: ${String(Math.round(snapshot.temperatureC))}°C — ${String(hp)} HP, suit -${String(suit)} over ${String(elapsedMinutes)} min.`);
        } else {
            const label = isHot ? 'HIGH TEMP' : 'LOW TEMP';
            messages.push(`${label}: ${String(Math.round(snapshot.temperatureC))}°C — suit integrity -${String(suit)} over ${String(elapsedMinutes)} min.`);
        }
    }

    // Apply damage to state
    if (hpDamage > 0) {
        state.hp = Math.max(0, state.hp - hpDamage);
        state.metrics.totalDamageTaken += hpDamage;
    }
    if (suitDamage > 0) {
        state.suitIntegrity = Math.max(0, state.suitIntegrity - suitDamage);
    }
    if (oxygenDrain > 0) {
        state.oxygen = Math.max(0, state.oxygen - oxygenDrain);
    }

    // Check death conditions
    if (state.hp <= 0) {
        state.gameOver = true;
        state.metrics.deathCause = 'Environmental exposure';
    }
    if (state.oxygen <= 0) {
        state.gameOver = true;
        state.metrics.deathCause = 'Asphyxiation — oxygen depleted';
    }
    if (state.suitIntegrity <= 0 && snapshot.pressureKpa < 70) {
        state.gameOver = true;
        state.metrics.deathCause = 'Suit failure — decompression';
    }

    return { hpDamage, suitDamage, oxygenDrain, messages };
}

// ─── Environment Tracker ─────────────────────────────────────────────────────

type TrendKey = 'oxygenPct' | 'co2Ppm' | 'pressureKpa' | 'temperatureC' | 'radiationMsv' | 'structuralPct';

const TREND_KEYS: TrendKey[] = ['oxygenPct', 'co2Ppm', 'pressureKpa', 'temperatureC', 'radiationMsv', 'structuralPct'];
const TREND_EPSILON = 0.05;

function defaultTrends(): Record<TrendKey, TrendDirection> {
    return {
        oxygenPct: 'stable',
        co2Ppm: 'stable',
        pressureKpa: 'stable',
        temperatureC: 'stable',
        radiationMsv: 'stable',
        structuralPct: 'stable',
    };
}

export class EnvironmentTracker {
    private prev: EnvironmentSnapshot | null = null;
    private readout: EnvironmentReadout = {
        snapshot: {
            oxygenPct: 21, co2Ppm: 400, pressureKpa: 101, temperatureC: 22,
            radiationMsv: 0.1, structuralPct: 98, gravityG: 1.0, powerStatus: 'nominal',
            ppO2: 21.2, hypoxiaRisk: 'nominal', activeFailureCount: 0,
        },
        trends: defaultTrends(),
    };

    update(room: Room, activeEvents: readonly ActiveEvent[]): EnvironmentReadout {
        const snapshot = computeEnvironment(room, activeEvents);
        const trends = defaultTrends();

        if (this.prev) {
            for (const key of TREND_KEYS) {
                const delta = snapshot[key] - this.prev[key];
                if (delta > TREND_EPSILON) trends[key] = 'rising';
                else if (delta < -TREND_EPSILON) trends[key] = 'falling';
            }
        }

        this.prev = snapshot;
        this.readout = { snapshot, trends };
        return this.readout;
    }

    current(): EnvironmentReadout {
        return this.readout;
    }
}
