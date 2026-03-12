import type { GameState, GeneratedStation } from './types.js';
import type { GameResponse } from './schema.js';
import { getActiveObjectiveStep } from './objectives.js';

/** Validate AI output against game rules. Returns issue strings or empty array. */
export function validateGameResponse(
    response: GameResponse,
    _state: GameState,
    station: GeneratedStation,
): string[] {
    const issues: string[] = [];

    for (const seg of response.segments) {
        if (seg.type === 'dialogue') {
            issues.push('Dialogue segments are disabled; use narration instead.');
        }
        if (seg.npcId) {
            issues.push(`npcId is no longer supported: ${seg.npcId}`);
        }
        // Crew echo must reference a roster member
        if (seg.type === 'crew_echo' && seg.crewName) {
            const found = station.crewRoster.some(c => c.name === seg.crewName);
            if (!found) issues.push(`Unknown crew name: ${seg.crewName}`);
        }
    }

    return issues;
}

function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasPressure(state: GameState, station: GeneratedStation): boolean {
    const room = station.rooms.get(state.currentRoom);
    const activeFailures = room?.systemFailures.some((failure) =>
        failure.challengeState !== 'resolved' && failure.challengeState !== 'failed'
    ) ?? false;
    return state.activeEvents.length > 0
        || activeFailures
        || state.hp / state.maxHp < 0.5
        || state.oxygen < state.maxOxygen
        || state.suitIntegrity < 100;
}

export function validateNarrativeHooks(
    response: GameResponse,
    state: GameState,
    station: GeneratedStation,
): string[] {
    if (response.segments.length === 0) return [];

    const issues: string[] = [];
    const firstText = response.segments.find((segment) => segment.text.trim().length > 0)?.text.trim() ?? '';
    const normalizedFirst = normalizeForMatch(firstText);

    if (/^i (look around|scan the room|check the room|take in my surroundings)\b/.test(normalizedFirst)) {
        issues.push('Opening beat is too generic; start with a sharper hook or consequence.');
    }

    if (hasPressure(state, station) && !response.segments.some((segment) => segment.type === 'thought')) {
        issues.push('Pressured turn missing thought segment for stakes, calculations, or consequence framing.');
    }

    const currentStep = getActiveObjectiveStep(station.objectives);
    if (currentStep) {
        const roomName = station.rooms.get(currentStep.roomId)?.name ?? currentStep.roomId;
        const systemName = currentStep.requiredSystemRepair?.replace(/_/g, ' ') ?? '';
        const itemName = currentStep.requiredItemId
            ? (station.items.get(currentStep.requiredItemId)?.name ?? currentStep.requiredItemId)
            : '';
        const joined = normalizeForMatch(response.segments.map((segment) => segment.text).join(' '));
        const objectiveSignals = [
            normalizeForMatch(roomName),
            normalizeForMatch(systemName),
            normalizeForMatch(itemName),
        ].filter((signal) => signal.length > 0);

        if (objectiveSignals.length > 0 && !objectiveSignals.some((signal) => joined.includes(signal))) {
            issues.push('Response does not surface the current objective pressure or blocker clearly enough.');
        }
    }

    return issues;
}

/** Build a corrective system message when the output guardrail trips. */
export function buildGuardrailFeedback(
    issues: string[],
    state: GameState,
    station: GeneratedStation,
    toolFailures?: { tool: string; summary: string }[],
): string {
    const parts: string[] = [
        'PREVIOUS RESPONSE REJECTED — validation errors:',
        ...issues.map(i => `- ${i}`),
        '',
    ];

    // Valid crew roster
    if (station.crewRoster.length > 0) {
        parts.push('Valid crew roster names (use exact name for crewName):');
        parts.push(`- ${station.crewRoster.map(c => c.name).join(', ')}`);
        parts.push('');
    }

    if (toolFailures && toolFailures.length > 0) {
        parts.push('Tool calls that FAILED this turn (do NOT narrate as successful):');
        for (const f of toolFailures) {
            parts.push(`- ${f.tool}: ${f.summary}`);
        }
        parts.push('');
    }

    // Ground truth state so the AI knows exactly what to narrate from
    const room = station.rooms.get(state.currentRoom);
    const exits = room
        ? room.connections.map(id => station.rooms.get(id)?.name ?? id)
        : [];
    const inventoryNames = state.inventory.map(id => station.items.get(id)?.name ?? id);

    parts.push('GROUND TRUTH — current game state (authoritative):');
    parts.push(`- Current room: "${room?.name ?? state.currentRoom}"`);
    parts.push(`- HP: ${String(state.hp)}/${String(state.maxHp)}`);
    parts.push(`- Inventory: [${inventoryNames.join(', ')}]`);
    parts.push(`- Available exits: [${exits.join(', ')}]`);
    if (state.oxygen < state.maxOxygen) {
        parts.push(`- Oxygen: ${String(state.oxygen)}/${String(state.maxOxygen)}`);
    }
    if (state.suitIntegrity < 100) {
        parts.push(`- Suit integrity: ${String(state.suitIntegrity)}%`);
    }
    parts.push('');

    parts.push('Re-generate your response using only valid identifiers and consistent with the ground truth above.');
    return parts.join('\n');
}

interface StateConsistencyIssue {
    field: string;
    problem: string;
    fixed: boolean;
}

/** Post-turn safety net: clamp out-of-bounds values and detect structural problems. */
export function validateStateConsistency(
    state: GameState,
    station: GeneratedStation,
): StateConsistencyIssue[] {
    const issues: StateConsistencyIssue[] = [];

    // HP bounds
    if (state.hp < 0) {
        issues.push({ field: 'hp', problem: `HP was ${String(state.hp)}, clamped to 0`, fixed: true });
        state.hp = 0;
    } else if (state.hp > state.maxHp) {
        issues.push({ field: 'hp', problem: `HP was ${String(state.hp)}, clamped to ${String(state.maxHp)}`, fixed: true });
        state.hp = state.maxHp;
    }

    // Oxygen bounds
    if (state.oxygen < 0) {
        issues.push({ field: 'oxygen', problem: `Oxygen was ${String(state.oxygen)}, clamped to 0`, fixed: true });
        state.oxygen = 0;
    } else if (state.oxygen > state.maxOxygen) {
        issues.push({ field: 'oxygen', problem: `Oxygen was ${String(state.oxygen)}, clamped to ${String(state.maxOxygen)}`, fixed: true });
        state.oxygen = state.maxOxygen;
    }

    // Suit integrity bounds (0–100)
    if (state.suitIntegrity < 0) {
        issues.push({ field: 'suitIntegrity', problem: `Suit integrity was ${String(state.suitIntegrity)}, clamped to 0`, fixed: true });
        state.suitIntegrity = 0;
    } else if (state.suitIntegrity > 100) {
        issues.push({ field: 'suitIntegrity', problem: `Suit integrity was ${String(state.suitIntegrity)}, clamped to 100`, fixed: true });
        state.suitIntegrity = 100;
    }

    // Room exists in station
    if (!station.rooms.has(state.currentRoom)) {
        issues.push({ field: 'currentRoom', problem: `Room "${state.currentRoom}" not found in station`, fixed: false });
    }

    // Inventory items exist in station.items
    const phantoms = state.inventory.filter(id => !station.items.has(id));
    if (phantoms.length > 0) {
        state.inventory = state.inventory.filter(id => station.items.has(id));
        issues.push({ field: 'inventory', problem: `Removed phantom items: ${phantoms.join(', ')}`, fixed: true });
    }

    // Inventory over max (log-only)
    if (state.inventory.length > state.maxInventory) {
        issues.push({ field: 'inventory', problem: `Inventory size ${String(state.inventory.length)} exceeds max ${String(state.maxInventory)}`, fixed: false });
    }

    return issues;
}
