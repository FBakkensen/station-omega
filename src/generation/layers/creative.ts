/**
 * Layer 4: Creative Content
 *
 * Adapted from the original src/creative.ts to use the layer runner
 * pattern. Generates names, descriptions, sensory details, crew logs,
 * arrival scenario, starting item, and NPC creative content.
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
import type { ValidatedObjectivesNPCs } from './objectives-npcs.js';
import type {
    CreativeContent,
    RoomCreative,
    ItemCreative,
    CrewMember,
    ArrivalScenario,
    StartingItemCreative,
    NPCCreative,
} from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const CreativeLayerSchema = z.object({
    stationName: z.string(),
    briefing: z.string(),
    backstory: z.string(),
    crewRoster: z.array(z.object({
        name: z.string(),
        role: z.string(),
        fate: z.string(),
    })),
    rooms: z.array(z.object({
        roomId: z.string(),
        name: z.string(),
        descriptionSeed: z.string(),
        engineeringNotes: z.string(),
        sensory: z.object({
            sounds: z.array(z.string()),
            smells: z.array(z.string()),
            visuals: z.array(z.string()),
            tactile: z.string(),
        }),
        crewLogs: z.array(z.object({
            type: z.string(),
            author: z.string(),
            content: z.string(),
            condition: z.string(),
        })),
    })),
    items: z.array(z.object({
        itemId: z.string(),
        name: z.string(),
        description: z.string(),
        useNarration: z.string(),
    })),
    arrivalScenario: z.object({
        playerBackstory: z.string(),
        arrivalCondition: z.string(),
        knowledgeLevel: z.enum(['familiar', 'partial', 'none']),
        openingLine: z.string(),
    }),
    startingItem: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.enum(['medical', 'tool', 'material']),
        effectType: z.enum(['heal', 'tool', 'material']),
        effectValue: z.number(),
        useNarration: z.string(),
    }),
    npcCreative: z.array(z.object({
        npcId: z.string(),
        name: z.string(),
        appearance: z.string(),
        personality: z.string(),
        soundSignature: z.string(),
    })).optional(),
});

export type CreativeLayerOutput = z.infer<typeof CreativeLayerSchema>;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildCreativePrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;

    const system = `You are a creative content generator for a sci-fi engineering survival adventure with dry humor, set on a derelict space station with cascading system failures.

# Style

Grounded sci-fi with personality. The Martian meets Project Hail Mary. The station is falling apart — systems are the antagonist, not creatures. Crew logs should read like frustrated engineering reports, sarcastic maintenance memos, or panicked calibration records. Tell a coherent story of cascading system failures matching the scenario theme.

# Rules

- Every roomId in your output MUST match a room ID from the station data provided
- Every itemId in your output MUST match an item ID from the station data provided
- Crew log authors must come from the crew roster you generate
- Room names must be practical engineering labels — the kind of names that would be on actual station bulkhead signs (e.g., "Primary Coolant Junction", "Atmospheric Processing Bay", "Cargo Lock C-7")
- Keep descriptions concise — focus on what's broken, what's working, what the sensors read. Engineering details, not atmosphere
- Item names must be immersive and in-universe. Name items as a space station engineer would label equipment
- engineeringNotes: 1-2 sentences of technical detail about the room's systems — what's nominal, what's degraded, what readings are off
- Generate 3-5 crew roster members (engineers, scientists, technicians)
- Each room should have 1-2 crew logs (prefer engineering_report, calibration_record, failure_analysis types)
- Provide 3 sounds, 2 smells, and 3 visuals per room — focus on diagnostic clues (the sound a pump makes when it's cavitating, the smell of coolant, the flicker pattern of failing lights)
- Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis

# Arrival Scenario

- arrivalScenario: Why is the player in the starting room on this station?
  - playerBackstory: 2-3 sentences
  - arrivalCondition: 1 sentence physical/mental state
  - knowledgeLevel: "familiar", "partial", or "none"
  - openingLine: First-person, visceral, sensory

# Starting Item

An item the player finds immediately in the starting room. Must fit the scenario:
- Medical items: category "medical", effectType "heal", effectValue 15-40
- Tools: category "tool", effectType "tool", effectValue 1
- Materials: category "material", effectType "material", effectValue 1

# NPC Creative Content

For each NPC in the station, generate creative content:
- npcId: must match an NPC ID from the station data
- name: an in-universe character name
- appearance: 1-2 sentences describing what they look like
- personality: 1-2 sentences describing their personality and demeanor
- soundSignature: a brief description of their voice quality for TTS (e.g., "gravelly baritone", "nervous alto")`;

    const roomsSummary = topology.rooms.map(r => {
        const failures = systemsItems.roomFailures.find(rf => rf.roomId === r.id);
        const failureStr = failures
            ? failures.failures.map(f => `${f.systemId}(${f.failureMode}, sev${String(f.severity)})`).join(', ')
            : 'none';
        return `  ${r.id} (${r.archetype}) — failures: [${failureStr}]`;
    }).join('\n');

    const itemsSummary = systemsItems.items.map(i =>
        `  ${i.id} (${i.baseItemKey}) in ${i.roomId}${i.isKeyItem ? ' [KEY]' : ''}`,
    ).join('\n');

    const npcSummary = objectivesNPCs.npcs.length > 0
        ? objectivesNPCs.npcs.map(n =>
            `  ${n.id} in ${n.roomId} — ${n.disposition} ${n.role}, behaviors: [${n.behaviors.join(', ')}]`,
        ).join('\n')
        : '  (none)';

    const objSummary = objectivesNPCs.objectives.steps.map((s, i) =>
        `  ${String(i + 1)}. ${s.description} (in ${s.roomId})`,
    ).join('\n');

    let user = `Generate creative content for this station:

Scenario: ${topology.scenario.theme} — ${topology.scenario.centralTension}
Topology: ${topology.topology}
Character: ${context.characterClass}
Difficulty: ${context.difficulty}

Objectives (${objectivesNPCs.objectives.title}):
${objSummary}

Rooms:
${roomsSummary}

Items:
${itemsSummary}

NPCs:
${npcSummary}

Generate creative content covering ALL rooms, ALL items, and ALL NPCs listed above.
Briefing: 1-2 sentences. Backstory: 2-3 sentences. Room descriptions: 2-3 sentences each.`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

const VALID_LOG_TYPES = new Set([
    'datapad', 'wall_scrawl', 'audio_recording', 'terminal_entry',
    'engineering_report', 'calibration_record', 'failure_analysis',
]);

function validateCreativeLayer(output: CreativeLayerOutput, context: LayerContext): ValidationResult<CreativeContent> {
    const topology = context['topology'] as ValidatedTopology;
    const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
    const objectivesNPCs = context['objectivesNPCs'] as ValidatedObjectivesNPCs;
    const errors: string[] = [];

    const roomIds = new Set(topology.rooms.map(r => r.id));
    const itemIds = new Set(systemsItems.items.map(i => i.id));
    const npcIds = new Set(objectivesNPCs.npcs.map(n => n.id));

    // Check all rooms are covered
    const coveredRooms = new Set(output.rooms.map(r => r.roomId));
    const missingRooms = [...roomIds].filter(id => !coveredRooms.has(id));
    if (missingRooms.length > 0) {
        errors.push(`Room creative content missing for: [${missingRooms.join(', ')}] — you must provide creative content for all rooms`);
    }

    // Check all items are covered
    const coveredItems = new Set(output.items.map(i => i.itemId));
    const missingItems = [...itemIds].filter(id => !coveredItems.has(id));
    if (missingItems.length > 0) {
        errors.push(`Item creative content missing for: [${missingItems.join(', ')}] — you must provide creative content for all items`);
    }

    // Check all NPCs are covered
    if (npcIds.size > 0) {
        const coveredNPCs = new Set((output.npcCreative ?? []).map(n => n.npcId));
        const missingNPCs = [...npcIds].filter(id => !coveredNPCs.has(id));
        if (missingNPCs.length > 0) {
            errors.push(`NPC creative content missing for: [${missingNPCs.join(', ')}] — you must provide creative content for all NPCs`);
        }
    }

    // Check crew log authors against roster
    const crewNames = new Set(output.crewRoster.map(c => c.name));
    for (const room of output.rooms) {
        for (const log of room.crewLogs) {
            if (!crewNames.has(log.author) && log.author !== 'Unknown') {
                errors.push(`Crew log author '${log.author}' in room '${room.roomId}' does not appear in the crew roster. Roster: [${[...crewNames].join(', ')}]`);
            }
        }
    }

    // Check crew roster minimum
    if (output.crewRoster.length < 3) {
        errors.push(`Crew roster has ${String(output.crewRoster.length)} members — generate at least 3`);
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    // Assemble validated creative content with fallbacks for missing fields
    const crewRoster: CrewMember[] = output.crewRoster.map(c => ({
        name: c.name,
        role: c.role,
        fate: c.fate,
    }));

    const rooms: RoomCreative[] = topology.rooms.map(skRoom => {
        const creative = output.rooms.find(r => r.roomId === skRoom.id);
        const validLogs = (creative?.crewLogs ?? [])
            .filter(log => crewNames.has(log.author) || log.author === 'Unknown')
            .map(log => ({
                type: (VALID_LOG_TYPES.has(log.type) ? log.type : 'terminal_entry') as RoomCreative['crewLogs'][number]['type'],
                author: log.author,
                content: log.content,
                condition: log.condition,
            }));

        return {
            roomId: skRoom.id,
            name: creative?.name ?? `${skRoom.archetype.charAt(0).toUpperCase()}${skRoom.archetype.slice(1)} ${skRoom.id.split('_')[1] ?? ''}`.trim(),
            descriptionSeed: creative?.descriptionSeed ?? `A ${skRoom.archetype} area of the station.`,
            sensory: creative
                ? {
                    sounds: creative.sensory.sounds,
                    smells: creative.sensory.smells,
                    visuals: creative.sensory.visuals,
                    tactile: creative.sensory.tactile,
                }
                : {
                    sounds: ['The hum of failing systems'],
                    smells: ['Stale recycled air'],
                    visuals: ['Emergency lights flicker dimly'],
                    tactile: 'The air feels stale and cold.',
                },
            crewLogs: validLogs.length > 0 ? validLogs : [{
                type: 'engineering_report' as const,
                author: crewRoster[0]?.name ?? 'Unknown',
                content: 'Systems degrading faster than projected. Running out of workarounds.',
                condition: 'A flickering terminal display.',
            }],
            engineeringNotes: creative?.engineeringNotes ?? '',
        };
    });

    const items: ItemCreative[] = systemsItems.items.map(skItem => {
        const creative = output.items.find(i => i.itemId === skItem.id);
        return {
            itemId: skItem.id,
            name: creative?.name ?? skItem.baseItemKey.replace(/_/g, ' '),
            description: creative?.description ?? skItem.baseItemKey.replace(/_/g, ' '),
            useNarration: creative?.useNarration ?? `You use the ${skItem.baseItemKey.replace(/_/g, ' ')}.`,
        };
    });

    const stationName = output.stationName;

    const arrivalScenario: ArrivalScenario = {
        playerBackstory: output.arrivalScenario.playerBackstory,
        arrivalCondition: output.arrivalScenario.arrivalCondition,
        knowledgeLevel: output.arrivalScenario.knowledgeLevel,
        openingLine: output.arrivalScenario.openingLine,
    };

    const startingItem: StartingItemCreative = {
        id: output.startingItem.id,
        name: output.startingItem.name,
        description: output.startingItem.description,
        category: output.startingItem.category,
        effectType: output.startingItem.effectType,
        effectValue: output.startingItem.effectValue,
        useNarration: output.startingItem.useNarration,
    };

    const npcCreative: NPCCreative[] = (output.npcCreative ?? [])
        .filter(n => npcIds.has(n.npcId))
        .map(n => ({
            npcId: n.npcId,
            name: n.name,
            appearance: n.appearance,
            personality: n.personality,
            soundSignature: n.soundSignature,
        }));

    return validationSuccess<CreativeContent>({
        stationName,
        briefing: output.briefing,
        backstory: output.backstory,
        crewRoster,
        rooms,
        items,
        arrivalScenario,
        startingItem,
        npcCreative: npcCreative.length > 0 ? npcCreative : undefined,
    });
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const creativeLayer: LayerConfig<CreativeLayerOutput, CreativeContent> = {
    name: 'Creative',
    schema: CreativeLayerSchema,
    buildPrompt: buildCreativePrompt,
    validate: validateCreativeLayer,
    maxRetries: 3,
    timeoutMs: 300_000,       // 5 minutes — creative layer generates the most content
    maxOutputTokens: 16_384,  // ~8-10K tokens for all rooms, items, NPCs, crew logs
};
