/**
 * Creative Sub-Layer: Per-Room Content
 *
 * Generates creative content for a SINGLE room. The orchestrator
 * creates one layer config per room and runs them all in parallel.
 * Each room completes in ~15-25s with independent retry.
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

const SingleRoomSchema = z.object({
    roomId: z.string(),
    name: z.string(),
    descriptionSeed: z.string(),
    engineeringNotes: z.string(),
    sensory: z.object({
        sounds: z.array(z.string().min(1)),
        smells: z.array(z.string().min(1)),
        visuals: z.array(z.string().min(1)),
        tactile: z.string().min(1),
    }),
    crewLogs: z.array(z.object({
        type: z.string(),
        author: z.string(),
        content: z.string(),
        condition: z.string(),
    })),
});

type SingleRoomOutput = z.infer<typeof SingleRoomSchema>;

// ─── Per-Room Layer Factory ──────────────────────────────────────────────────

/**
 * Creates a LayerConfig that generates creative content for a single room.
 * The orchestrator calls this once per room, running all in parallel.
 */
export function createSingleRoomLayer(
    targetRoomId: string,
    roomIndex: number,
): LayerConfig<SingleRoomOutput, RoomCreative> {
    return {
        name: `Creative/Room-${String(roomIndex)}`,
        schema: SingleRoomSchema,
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
- Room name must be a practical engineering label — the kind of name on an actual station bulkhead sign (e.g., "Primary Coolant Junction", "Atmospheric Processing Bay", "Cargo Lock C-7")
- descriptionSeed: 2-3 sentences. Focus on what's broken, what's working, what the sensors read
- engineeringNotes: 1-2 sentences of technical detail — what's nominal, what's degraded, what readings are off
- Sensory: 3 sounds, 2 smells, 3 visuals — focus on diagnostic clues (pump cavitation, coolant smell, flickering lights)
- tactile: 1 sentence
- Generate 1-2 crew logs
- Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis
- CRITICAL: Crew log authors MUST come from this roster: ${crewNames}. Do NOT invent new authors.
- Logs should read like frustrated engineering reports, sarcastic maintenance memos, or panicked calibration records

# Sensory Variety
- Each sound must describe a DIFFERENT source mechanism — avoid repeating "ticking", "hissing", or "humming" across rooms. Use unique mechanical sources (pump cavitation, relay chatter, valve stutter, bearing whine, etc.)
- Tactile descriptions must vary — not every room should mention boot soles or heat. Use vibrations, air currents, surface textures, condensation, static charge, etc.
- At least one sound per room should be unique to that room's specific failure mode or archetype

# Crew Log Temporal Consistency
- If crew logs reference specific timestamps, avoid stating precise time gaps (like "two hours before the incident") unless the exact timeline is provided. Use vague references like "hours before", "earlier that shift", or "sometime before everything went sideways" instead`;

            let user = `Generate creative content for this room:

  ${targetRoomId} (${archetype}) — failures: [${failureStr}] — items: [${itemStr}]

Crew roster (use ONLY these names as log authors):
${identity.crewRoster.map(c => `  ${c.name} — ${c.role}, ${c.fate}`).join('\n')}`;

            if (errors && errors.length > 0) {
                user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
            }

            return { system, user };
        },
        validate: (output: SingleRoomOutput, context: LayerContext): ValidationResult<RoomCreative> => {
            const topology = context['topology'] as ValidatedTopology;
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

            // Sensory array count checks (minItems/maxItems not supported by Anthropic's structured output)
            if (output.sensory.sounds.length === 0) errors.push('sensory.sounds is empty — provide at least 1');
            if (output.sensory.smells.length === 0) errors.push('sensory.smells is empty — provide at least 1');
            if (output.sensory.visuals.length === 0) errors.push('sensory.visuals is empty — provide at least 1');

            // Reject whitespace-only sensory strings (trim() can't be in schema — breaks Output.object())
            const sensoryFields: [string, string[]][] = [
                ['sounds', output.sensory.sounds],
                ['smells', output.sensory.smells],
                ['visuals', output.sensory.visuals],
            ];
            for (const [field, arr] of sensoryFields) {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].trim().length === 0) {
                        errors.push(`sensory.${field}[${String(i)}] is whitespace-only — provide real content`);
                    }
                }
            }
            if (output.sensory.tactile.trim().length === 0) {
                errors.push(`sensory.tactile is whitespace-only — provide real content`);
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

            // Assemble validated room creative with fallbacks
            const skRoom = topology.rooms.find(r => r.id === targetRoomId);
            const validLogs = output.crewLogs
                .filter(log => crewNames.has(log.author) || log.author === 'Unknown')
                .map(log => ({
                    type: (VALID_LOG_TYPES.has(log.type) ? log.type : 'terminal_entry') as RoomCreative['crewLogs'][number]['type'],
                    author: log.author,
                    content: log.content,
                    condition: log.condition,
                }));

            const fallbackName = skRoom
                ? `${skRoom.archetype.charAt(0).toUpperCase()}${skRoom.archetype.slice(1)} ${skRoom.id.split('_')[1] ?? ''}`.trim()
                : targetRoomId;

            return validationSuccess<RoomCreative>({
                roomId: targetRoomId,
                name: output.name || fallbackName,
                descriptionSeed: output.descriptionSeed || `A section of the station.`,
                sensory: {
                    sounds: output.sensory.sounds,
                    smells: output.sensory.smells,
                    visuals: output.sensory.visuals,
                    tactile: output.sensory.tactile,
                },
                crewLogs: validLogs,
                engineeringNotes: output.engineeringNotes,
            }, repairs);
        },
        maxRetries: 2,
        timeoutMs: 90_000,
        maxOutputTokens: 2048,
        summarize: (v) => `${v.roomId}: "${v.name}"`,
    };
}
