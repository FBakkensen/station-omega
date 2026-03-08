/**
 * Creative Sub-Layer: Per-Room Prose
 *
 * Generates prose-only content (descriptionSeed, crewLogs) for a SINGLE room.
 * Mechanical content (name, sensory, engineeringNotes) is generated separately
 * by the room mechanical batch layer. The orchestrator merges both sources
 * into the final RoomCreative[].
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedTopology } from './topology.js';
import type { ValidatedSystemsItems } from './systems-items.js';
import type { ValidatedIdentitySeed } from './creative-identity.js';
import type { RoomCreative } from '../../types.js';
import { findCrewMatch, VALID_LOG_TYPES } from './creative.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const SingleRoomProseSchema = z.object({
    roomId: z.string(),
    descriptionSeed: z.string(),
    crewLogs: z.array(z.object({
        type: z.string(),
        author: z.string(),
        content: z.string(),
        condition: z.string(),
    })),
});

type SingleRoomProseOutput = z.infer<typeof SingleRoomProseSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface RoomProseResult {
    roomId: string;
    descriptionSeed: string;
    crewLogs: RoomCreative['crewLogs'];
}

// ─── Per-Room Layer Factory ──────────────────────────────────────────────────

/**
 * Creates a LayerConfig that generates prose content for a single room.
 * The orchestrator calls this once per room, running all in parallel.
 */
export function createSingleRoomLayer(
    targetRoomId: string,
    roomIndex: number,
): LayerConfig<SingleRoomProseOutput, RoomProseResult> {
    return {
        name: `Creative/Room-${String(roomIndex)}`,
        schema: SingleRoomProseSchema,
        buildPrompt: (context: LayerContext, errors?: string[]) => {
            const topology = context['topology'] as ValidatedTopology;
            const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
            const identity = context['identitySeed'] as ValidatedIdentitySeed;

            const room = topology.rooms.find(r => r.id === targetRoomId);
            const archetype = room?.archetype ?? 'unknown';

            const failures = systemsItems.roomFailures.find(rf => rf.roomId === targetRoomId);
            const failureStr = failures
                ? failures.failures.map(f => `${f.systemId}(${f.failureMode}, sev${String(f.severity)})`).join(', ')
                : 'none';

            const items = systemsItems.items.filter(i => i.roomId === targetRoomId);
            const itemStr = items.length > 0
                ? items.map(i => `${i.id}(${i.baseItemKey}${i.isKeyItem ? ', KEY' : ''})`).join(', ')
                : 'none';

            const crewNames = identity.crewRoster.map(c => `${c.name} (${c.role})`).join(', ');

            const system = `You are a creative content generator for a sci-fi engineering survival adventure set on a derelict space station.

# Station Identity
- Name: ${identity.stationName}
- Backstory: ${identity.backstory}
- Tone: ${identity.toneKeywords.join(', ')}

# Rules

- roomId in your output MUST be exactly "${targetRoomId}"
- descriptionSeed: 2-3 sentences. Focus on what's broken, what's working, what the sensors read
- Generate 1-2 crew logs
- Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis
- CRITICAL: Crew log authors MUST come from this roster: ${crewNames}. Do NOT invent new authors.
- Logs should read like frustrated engineering reports, sarcastic maintenance memos, or panicked calibration records

# Crew Log Temporal Consistency
- If crew logs reference specific timestamps, avoid stating precise time gaps (like "two hours before the incident") unless the exact timeline is provided. Use vague references like "hours before", "earlier that shift", or "sometime before everything went sideways" instead`;

            let user = `Generate prose content for this room:

  ${targetRoomId} (${archetype}) — failures: [${failureStr}] — items: [${itemStr}]

Crew roster (use ONLY these names as log authors):
${identity.crewRoster.map(c => `  ${c.name} — ${c.role}, ${c.fate}`).join('\n')}`;

            if (errors && errors.length > 0) {
                user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
            }

            return { system, user };
        },
        validate: (output: SingleRoomProseOutput, context: LayerContext): ValidationResult<RoomProseResult> => {
            const identity = context['identitySeed'] as ValidatedIdentitySeed;
            const errors: string[] = [];
            const repairs: string[] = [];
            const crewNames = new Set(identity.crewRoster.map(c => c.name));

            // roomId must match the target
            if (output.roomId !== targetRoomId) {
                errors.push(`Expected roomId '${targetRoomId}', got '${output.roomId}'`);
            }

            // Must have at least 1 crew log
            if (output.crewLogs.length === 0) {
                errors.push(`Room '${targetRoomId}' has no crew logs — generate at least 1`);
            }

            // Crew log author validation with fuzzy matching
            for (const log of output.crewLogs) {
                if (log.author === 'Unknown') continue;
                const match = findCrewMatch(log.author, crewNames);
                if (match) {
                    if (match !== log.author) {
                        repairs.push(`Crew log in ${targetRoomId}: fuzzy-matched author '${log.author}' → '${match}'`);
                    }
                    log.author = match;
                } else {
                    errors.push(`Crew log author '${log.author}' in room '${targetRoomId}' does not appear in the crew roster. Roster: [${[...crewNames].join(', ')}]`);
                }
            }

            if (errors.length > 0) {
                return validationFailure(errors);
            }

            // Assemble validated prose result
            const validLogs = output.crewLogs
                .filter(log => crewNames.has(log.author) || log.author === 'Unknown')
                .map(log => ({
                    type: (VALID_LOG_TYPES.has(log.type) ? log.type : 'terminal_entry') as RoomCreative['crewLogs'][number]['type'],
                    author: log.author,
                    content: log.content,
                    condition: log.condition,
                }));

            return validationSuccess<RoomProseResult>({
                roomId: targetRoomId,
                descriptionSeed: output.descriptionSeed || `A section of the station.`,
                crewLogs: validLogs,
            }, repairs);
        },
        maxRetries: 2,
        timeoutMs: 90_000,
        maxOutputTokens: 1024,
        summarize: (v) => `${v.roomId}: ${String(v.crewLogs.length)} logs`,
    };
}
