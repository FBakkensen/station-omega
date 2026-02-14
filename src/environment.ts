import type { Room, ActiveEvent } from './types.js';

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

    // Active event modifiers
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
