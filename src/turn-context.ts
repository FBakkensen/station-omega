import type { ActiveEvent, GameState, GeneratedStation, SystemFailure } from './types.js';
import { getEventContext } from './events.js';
import { computeEnvironment, type EnvironmentSnapshot } from './environment.js';
import { getActiveObjectiveStep } from './objectives.js';

function describeObjectivePressure(
    state: GameState,
    station: GeneratedStation,
): string | null {
    const currentStep = getActiveObjectiveStep(station.objectives);
    if (!currentStep) return null;

    const targetRoom = station.rooms.get(currentStep.roomId);
    const location = currentStep.roomId === state.currentRoom
        ? 'here now'
        : targetRoom?.name ?? currentStep.roomId;

    const blockers: string[] = [];

    if (currentStep.requiredSystemRepair) {
        const room = station.rooms.get(currentStep.roomId);
        const resolved = room?.systemFailures.some((failure) =>
            failure.systemId === currentStep.requiredSystemRepair && failure.challengeState === 'resolved'
        ) ?? false;
        if (!resolved) {
            blockers.push(`repair ${currentStep.requiredSystemRepair}`);
        }
    }

    if (currentStep.requiredItemId && !state.inventory.includes(currentStep.requiredItemId) && !state.hasObjectiveItem) {
        const itemName = station.items.get(currentStep.requiredItemId)?.name ?? currentStep.requiredItemId;
        blockers.push(`obtain ${itemName}`);
    }

    const blockerSummary = blockers.length > 0
        ? ` Blockers: ${blockers.join('; ')}.`
        : ' No hard blocker detected from current state.';

    return `OBJECTIVE PRESSURE: ${currentStep.description} | Location: ${location}.${blockerSummary}`;
}

function describeFailurePressure(failures: SystemFailure[]): string | null {
    if (failures.length === 0) return null;

    const nextFailure = [...failures].sort((a, b) => a.minutesUntilCascade - b.minutesUntilCascade)[0];
    return `CASCADE PRESSURE: ${nextFailure.systemId} in ${String(Math.round(nextFailure.minutesUntilCascade))} min | ${nextFailure.status}/${nextFailure.challengeState} | mode=${nextFailure.failureMode} | severity=${String(nextFailure.severity)}`;
}

function describeEventPressure(events: ActiveEvent[]): string | null {
    if (events.length === 0) return null;

    const nextEvent = [...events].sort((a, b) => a.minutesRemaining - b.minutesRemaining)[0];
    return `EVENT PRESSURE: ${nextEvent.type} in ${String(nextEvent.minutesRemaining)} min | ${nextEvent.effect}`;
}

function describeBodyPressure(
    state: GameState,
    env: EnvironmentSnapshot,
): string | null {
    const warnings: string[] = [];

    if (env.hypoxiaRisk === 'critical') {
        warnings.push(`ppO2 ${env.ppO2.toFixed(1)} kPa — cognition and consciousness are at immediate risk`);
    } else if (env.hypoxiaRisk === 'warning') {
        warnings.push(`ppO2 ${env.ppO2.toFixed(1)} kPa — thinking and fine motor control are starting to slip`);
    }

    const hpPct = state.hp / state.maxHp;
    if (hpPct < 0.5) {
        warnings.push(`HP ${String(state.hp)}/${String(state.maxHp)} — pain and fatigue are reducing precision`);
    }

    if (state.suitIntegrity < 100) {
        warnings.push(`suit integrity ${String(state.suitIntegrity)}% — the next abrasive or decompression hit will matter faster`);
    }

    if (env.radiationMsv >= 5) {
        warnings.push(`radiation ${env.radiationMsv.toFixed(1)} mSv — staying here longer is becoming a body problem`);
    }

    if (env.temperatureC <= 8 || env.temperatureC >= 38) {
        warnings.push(`temperature ${String(Math.round(env.temperatureC))}°C — the environment is actively working against stamina`);
    }

    if (warnings.length === 0) return null;
    return `BODY PRESSURE: ${warnings.join('; ')}`;
}

/** Build dynamic per-turn context as a system message. Returns null if no context needed. */
export function buildTurnContext(state: GameState, station: GeneratedStation, mechanicalEvents?: string[]): string | null {
    const parts: string[] = [];

    const hours = Math.floor(state.missionElapsedMinutes / 60);
    const mins = state.missionElapsedMinutes % 60;
    parts.push(`MISSION ELAPSED TIME: T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);

    const objectivePressure = describeObjectivePressure(state, station);
    if (objectivePressure) {
        parts.push(objectivePressure);
    }

    if (state.activeEvents.length > 0) {
        parts.push(getEventContext(state.activeEvents));
    }

    const eventPressure = describeEventPressure(state.activeEvents);
    if (eventPressure) {
        parts.push(eventPressure);
    }

    const roomNpcs = [...station.npcs.values()].filter((npc) => npc.roomId === state.currentRoom);
    for (const npc of roomNpcs) {
        if (npc.isAlly) {
            parts.push(`ALLY: ${npc.name} is helping you.`);
        }
    }

    const { mercy, sacrifice, pragmatic } = state.moralProfile.tendencies;
    if (mercy + sacrifice + pragmatic > 0) {
        parts.push(`MORAL PROFILE: mercy=${String(mercy)}, sacrifice=${String(sacrifice)}, pragmatic=${String(pragmatic)}`);
    }

    const hpPct = state.hp / state.maxHp;
    if (hpPct < 0.5) {
        parts.push(`PLAYER CONDITION: HP ${String(state.hp)}/${String(state.maxHp)} (${String(Math.round(hpPct * 100))}%)`);
    }

    if (state.oxygen < state.maxOxygen) {
        parts.push(`OXYGEN: ${String(state.oxygen)}/${String(state.maxOxygen)}`);
    }
    if (state.suitIntegrity < 100) {
        parts.push(`SUIT INTEGRITY: ${String(state.suitIntegrity)}%`);
    }

    const currentRoom = station.rooms.get(state.currentRoom);
    if (currentRoom) {
        const activeFailures = currentRoom.systemFailures.filter((failure) =>
            failure.challengeState !== 'resolved' && failure.challengeState !== 'failed'
        );
        if (activeFailures.length > 0) {
            const failureLines = activeFailures.map((failure) =>
                `- ${failure.systemId} [${failure.status}/${failure.challengeState}] mode=${failure.failureMode} sev=${String(failure.severity)} cascade=${String(Math.round(failure.minutesUntilCascade))}min`
            );
            parts.push(`SYSTEM FAILURES:\n${failureLines.join('\n')}`);
        }

        const failurePressure = describeFailurePressure(activeFailures);
        if (failurePressure) {
            parts.push(failurePressure);
        }

        const env = computeEnvironment(currentRoom, state.activeEvents);
        parts.push(
            `ENVIRONMENT: O₂ ${env.oxygenPct.toFixed(1)}% | CO₂ ${String(Math.round(env.co2Ppm))}ppm | ` +
            `Pressure ${env.pressureKpa.toFixed(1)}kPa | Temp ${String(Math.round(env.temperatureC))}°C | ` +
            `Rad ${env.radiationMsv.toFixed(1)}mSv | Structural ${String(Math.round(env.structuralPct))}%`
        );

        const bodyPressure = describeBodyPressure(state, env);
        if (bodyPressure) {
            parts.push(bodyPressure);
        }
    }

    if (mechanicalEvents && mechanicalEvents.length > 0) {
        parts.push(`## Mechanical Events This Turn\n${mechanicalEvents.join('\n')}`);
    }

    return parts.join('\n\n');
}
