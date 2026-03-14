import type {
    GameState,
    GeneratedStation,
    ObjectiveChain,
    ObjectiveStep,
} from './types.js';

export interface ObjectiveSyncResult {
    changed: boolean;
    newlyCompletedSteps: ObjectiveStep[];
    newlyRevealedSteps: ObjectiveStep[];
    missionCompleted: boolean;
    activeStep: ObjectiveStep | null;
}

function findFirstPendingStepIndex(objectives: ObjectiveChain): number {
    const firstPendingIndex = objectives.steps.findIndex((step) => !step.completed);
    return firstPendingIndex === -1 ? objectives.steps.length : firstPendingIndex;
}

export function normalizeObjectiveChain(objectives: ObjectiveChain): ObjectiveChain {
    if (objectives.completed) {
        objectives.currentStepIndex = objectives.steps.length;
        for (const step of objectives.steps) {
            step.completed = true;
            step.revealed = true;
        }
        return objectives;
    }

    const currentStepIndex = findFirstPendingStepIndex(objectives);
    const missionCompleted = currentStepIndex >= objectives.steps.length;

    objectives.currentStepIndex = currentStepIndex;
    objectives.completed = missionCompleted;

    for (const [index, step] of objectives.steps.entries()) {
        step.revealed = missionCompleted ? true : index <= currentStepIndex;
    }

    return objectives;
}

export function normalizeObjectiveChainWithLegacySupport(objectives: ObjectiveChain): ObjectiveChain {
    if (!(objectives as Partial<ObjectiveChain>).briefing) {
        objectives.briefing = '';
    }

    const missingRevealState = objectives.steps.some((step) => typeof step.revealed !== 'boolean');
    if (missingRevealState) {
        const currentStepIndex = findFirstPendingStepIndex(objectives);
        const missionCompleted = currentStepIndex >= objectives.steps.length;
        for (const [index, step] of objectives.steps.entries()) {
            step.revealed = missionCompleted ? true : index <= currentStepIndex;
        }
    }

    return normalizeObjectiveChain(objectives);
}

export function getActiveObjectiveStep(objectives: ObjectiveChain): ObjectiveStep | null {
    if (objectives.currentStepIndex < objectives.steps.length) {
        const indexedStep = objectives.steps[objectives.currentStepIndex];
        if (indexedStep.revealed && !indexedStep.completed) {
            return indexedStep;
        }
    }

    return objectives.steps.find((step) => step.revealed && !step.completed) ?? null;
}

export function isObjectiveStepSatisfied(
    state: GameState,
    station: GeneratedStation,
    step: ObjectiveStep,
): boolean {
    const inRoom = state.currentRoom === step.roomId;
    const hasItem = step.requiredItemId === null
        || state.inventory.includes(step.requiredItemId)
        || state.hasObjectiveItem;

    let systemRepaired = step.requiredSystemRepair === null;
    if (!systemRepaired) {
        const stepRoom = station.rooms.get(step.roomId);
        systemRepaired = stepRoom?.systemFailures.some((failure) =>
            failure.systemId === step.requiredSystemRepair && failure.challengeState === 'resolved',
        ) ?? false;
    }

    return inRoom && hasItem && systemRepaired;
}

export function syncObjectiveProgress(
    state: GameState,
    station: GeneratedStation,
): ObjectiveSyncResult | null {
    const objectives = normalizeObjectiveChainWithLegacySupport(station.objectives);
    const before = objectives.steps.map((step) => ({
        completed: step.completed,
        revealed: step.revealed,
    }));
    const wasMissionCompleted = objectives.completed;

    for (const step of objectives.steps) {
        if (!step.completed && isObjectiveStepSatisfied(state, station, step)) {
            step.completed = true;
        }
    }

    normalizeObjectiveChain(objectives);

    const newlyCompletedSteps = objectives.steps.filter((step, index) =>
        step.completed
        && step.revealed
        && (!before[index]?.completed || !before[index]?.revealed),
    );
    const newlyRevealedSteps = objectives.steps.filter((step, index) =>
        step.revealed && !step.completed && !before[index]?.revealed,
    );
    const changed = newlyCompletedSteps.length > 0
        || newlyRevealedSteps.length > 0
        || wasMissionCompleted !== objectives.completed;

    if (!changed) return null;

    return {
        changed,
        newlyCompletedSteps,
        newlyRevealedSteps,
        missionCompleted: !wasMissionCompleted && objectives.completed,
        activeStep: getActiveObjectiveStep(objectives),
    };
}

export function formatObjectiveUpdate(result: ObjectiveSyncResult | null): string | null {
    if (!result) return null;
    if (!result.missionCompleted && result.newlyCompletedSteps.length === 0 && result.newlyRevealedSteps.length === 0) {
        return null;
    }

    const parts: string[] = [];

    if (result.newlyCompletedSteps.length > 0) {
        const descriptions = result.newlyCompletedSteps.map((step) => `"${step.description}"`);
        parts.push(`OBJECTIVE STEP COMPLETE: ${descriptions.join(', ')} completed.`);
    }

    if (result.missionCompleted) {
        parts.push('OBJECTIVE COMPLETE: All steps done! Mission complete.');
    } else if (result.activeStep) {
        parts.push(`Next: "${result.activeStep.description}"`);
    }

    return parts.join(' ');
}
