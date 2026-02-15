import type { GameState, GeneratedStation } from './types.js';
import { getEventContext } from './events.js';
import { computeEnvironment } from './environment.js';

/** Build dynamic per-turn context as a system message. Returns null if no context needed. */
export function buildTurnContext(state: GameState, station: GeneratedStation): string | null {
    const parts: string[] = [];

    // Mission elapsed time
    const hours = Math.floor(state.missionElapsedMinutes / 60);
    const mins = state.missionElapsedMinutes % 60;
    parts.push(`MISSION ELAPSED TIME: T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);

    // Active events
    if (state.activeEvents.length > 0) {
        parts.push(getEventContext(state.activeEvents));
    }

    // NPC state hints (raw data for AI to interpret)
    const roomNpcs = [...station.npcs.values()].filter(n => n.roomId === state.currentRoom);
    for (const npc of roomNpcs) {
        if (npc.isAlly) {
            parts.push(`ALLY: ${npc.name} is helping you.`);
        }
    }

    // Moral profile (raw scores — let the AI interpret)
    const { mercy, sacrifice, pragmatic } = state.moralProfile.tendencies;
    if (mercy + sacrifice + pragmatic > 0) {
        parts.push(`MORAL PROFILE: mercy=${String(mercy)}, sacrifice=${String(sacrifice)}, pragmatic=${String(pragmatic)}`);
    }

    // Player condition as raw ratio
    const hpPct = state.hp / state.maxHp;
    if (hpPct < 0.5) {
        parts.push(`PLAYER CONDITION: HP ${String(state.hp)}/${String(state.maxHp)} (${String(Math.round(hpPct * 100))}%)`);
    }

    // Oxygen and suit integrity
    if (state.oxygen < state.maxOxygen) {
        parts.push(`OXYGEN: ${String(state.oxygen)}/${String(state.maxOxygen)}`);
    }
    if (state.suitIntegrity < 100) {
        parts.push(`SUIT INTEGRITY: ${String(state.suitIntegrity)}%`);
    }

    // System failures in current room
    const currentRoom = station.rooms.get(state.currentRoom);
    if (currentRoom) {
        const activeFailures = currentRoom.systemFailures.filter(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');
        if (activeFailures.length > 0) {
            const failureLines = activeFailures.map(f =>
                `- ${f.systemId} [${f.status}/${f.challengeState}] mode=${f.failureMode} sev=${String(f.severity)} cascade=${String(Math.round(f.minutesUntilCascade))}min`
            );
            parts.push(`SYSTEM FAILURES:\n${failureLines.join('\n')}`);
        }

        // Environment readings (matches sidebar display values)
        const env = computeEnvironment(currentRoom, state.activeEvents);
        parts.push(
            `ENVIRONMENT: O₂ ${env.oxygenPct.toFixed(1)}% | CO₂ ${String(Math.round(env.co2Ppm))}ppm | ` +
            `Pressure ${env.pressureKpa.toFixed(1)}kPa | Temp ${String(Math.round(env.temperatureC))}°C | ` +
            `Rad ${env.radiationMsv.toFixed(1)}mSv | Structural ${String(Math.round(env.structuralPct))}%`
        );
    }

    return parts.join('\n\n');
}
