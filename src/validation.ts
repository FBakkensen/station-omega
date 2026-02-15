import type { GameState, GeneratedStation } from './types.js';
import type { GameResponse } from './schema.js';

/** Validate AI output against game rules. Returns issue strings or empty array. */
export function validateGameResponse(
    response: GameResponse,
    state: GameState,
    station: GeneratedStation,
): string[] {
    const issues: string[] = [];

    for (const seg of response.segments) {
        // Dialogue must reference a living NPC in the current room
        if (seg.type === 'dialogue' && seg.npcId) {
            let npc = station.npcs.get(seg.npcId);
            if (!npc) {
                for (const n of station.npcs.values()) {
                    if (n.name === seg.npcId) { npc = n; break; }
                }
            }
            if (!npc) issues.push(`Unknown NPC ID: ${seg.npcId}`);
            else if (npc.roomId !== state.currentRoom) issues.push(`NPC not in room: ${seg.npcId}`);
        }
        // Crew echo must reference a roster member
        if (seg.type === 'crew_echo' && seg.crewName) {
            const found = station.crewRoster.some(c => c.name === seg.crewName);
            if (!found) issues.push(`Unknown crew name: ${seg.crewName}`);
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

    // Valid NPCs in current room
    const roomNpcs = [...station.npcs.values()]
        .filter(n => n.roomId === state.currentRoom);
    if (roomNpcs.length > 0) {
        parts.push('Valid NPCs in current room (use the "id" value for npcId):');
        for (const npc of roomNpcs) {
            parts.push(`- id: "${npc.id}", name: "${npc.name}", disposition: ${npc.disposition}`);
        }
        parts.push('');
    }

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

    parts.push('Re-generate your response using only valid identifiers.');
    return parts.join('\n');
}
