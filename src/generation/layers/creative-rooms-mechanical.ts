/**
 * Creative Sub-Layer: Room Mechanical Batch
 *
 * Generates mechanical room content (names, sensory details, engineering notes)
 * for ALL rooms in a single cheap model call. The orchestrator runs this before
 * the per-room prose calls, then merges the two sources into final RoomCreative[].
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
import { roomFallbackName } from './creative.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const RoomMechanicalBatchSchema = z.object({
  rooms: z.array(z.object({
    roomId: z.string(),
    name: z.string(),
    engineeringNotes: z.string(),
    sensory: z.object({
      sounds: z.array(z.string()),
      smells: z.array(z.string()),
      visuals: z.array(z.string()),
      tactile: z.string(),
    }),
  })),
});

type RoomMechanicalBatchOutput = z.infer<typeof RoomMechanicalBatchSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface RoomMechanicalResult {
  roomId: string;
  name: string;
  engineeringNotes: string;
  sensory: {
    sounds: string[];
    smells: string[];
    visuals: string[];
    tactile: string;
  };
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildRoomMechanicalBatchPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
  const topology = context['topology'] as ValidatedTopology;
  const systemsItems = context['systemsItems'] as ValidatedSystemsItems;
  const identity = context['identitySeed'] as ValidatedIdentitySeed;

  const system = `You are a creative content generator for a sci-fi engineering survival adventure set on a derelict space station.

# Station Identity
- Name: ${identity.stationName}
- Tone: ${identity.toneKeywords.join(', ')}

# Rules

Generate mechanical content (name, sensory details, engineering notes) for ALL rooms listed below.

## Room Names
- Room names must be practical engineering labels — the kind of name on an actual station bulkhead sign (e.g., "Primary Coolant Junction", "Atmospheric Processing Bay", "Cargo Lock C-7")

## Engineering Notes
- engineeringNotes: 1-2 sentences of technical detail — what's nominal, what's degraded, what readings are off

## Sensory Details
- Exactly 3 sounds, 2 smells, 3 visuals per room
- tactile: 1 sentence

## Sensory Variety
- Each sound must describe a DIFFERENT source mechanism — avoid repeating "ticking", "hissing", or "humming" across rooms. Use unique mechanical sources (pump cavitation, relay chatter, valve stutter, bearing whine, etc.)
- Tactile descriptions must vary — not every room should mention boot soles or heat. Use vibrations, air currents, surface textures, condensation, static charge, etc.
- At least one sound per room should be unique to that room's specific failure mode or archetype
- Focus sensory details on diagnostic clues (pump cavitation, coolant smell, flickering lights)`;

  const roomSummaries = topology.rooms.map(room => {
    const failures = systemsItems.roomFailures.find(rf => rf.roomId === room.id);
    const failureStr = failures
      ? failures.failures.map(f => `${f.systemId}(${f.failureMode}, sev${String(f.severity)})`).join(', ')
      : 'none';

    const items = systemsItems.items.filter(i => i.roomId === room.id);
    const itemStr = items.length > 0
      ? items.map(i => `${i.id}(${i.baseItemKey}${i.isKeyItem ? ', KEY' : ''})`).join(', ')
      : 'none';

    return `  ${room.id} (${room.archetype}) — failures: [${failureStr}] — items: [${itemStr}]`;
  }).join('\n');

  let user = `Generate mechanical content for ALL ${String(topology.rooms.length)} rooms:

${roomSummaries}

Output a rooms array with exactly ${String(topology.rooms.length)} entries, one per room, with matching roomId values.`;

  if (errors && errors.length > 0) {
    user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
  }

  return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateRoomMechanicalBatch(
  output: RoomMechanicalBatchOutput,
  context: LayerContext,
): ValidationResult<RoomMechanicalResult[]> {
  const topology = context['topology'] as ValidatedTopology;
  const errors: string[] = [];
  const repairs: string[] = [];

  const expectedIds = new Set(topology.rooms.map(r => r.id));
  const outputIds = new Set(output.rooms.map(r => r.roomId));

  // Check for duplicate roomIds in output
  const seenIds = new Set<string>();
  for (const room of output.rooms) {
    if (seenIds.has(room.roomId)) {
      errors.push(`Duplicate roomId '${room.roomId}' in output — each room must appear exactly once`);
    }
    seenIds.add(room.roomId);
  }

  // Check for invalid roomIds
  for (const room of output.rooms) {
    if (!expectedIds.has(room.roomId)) {
      errors.push(`Output contains roomId '${room.roomId}' which does not exist in topology. Valid IDs: [${[...expectedIds].join(', ')}]`);
    }
  }

  // Coverage check
  const missingIds = [...expectedIds].filter(id => !outputIds.has(id));
  if (missingIds.length > 0) {
    errors.push(`Missing mechanical content for rooms: [${missingIds.join(', ')}]`);
  }

  // Per-room validation
  for (const room of output.rooms) {
    if (!expectedIds.has(room.roomId)) continue;

    // Sensory arrays must not be empty
    if (room.sensory.sounds.length === 0) errors.push(`Room '${room.roomId}': sensory.sounds is empty — provide at least 1`);
    if (room.sensory.smells.length === 0) errors.push(`Room '${room.roomId}': sensory.smells is empty — provide at least 1`);
    if (room.sensory.visuals.length === 0) errors.push(`Room '${room.roomId}': sensory.visuals is empty — provide at least 1`);

    // No whitespace-only entries
    const sensoryFields: [string, string[]][] = [
      ['sounds', room.sensory.sounds],
      ['smells', room.sensory.smells],
      ['visuals', room.sensory.visuals],
    ];
    for (const [field, arr] of sensoryFields) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].trim().length === 0) {
          errors.push(`Room '${room.roomId}': sensory.${field}[${String(i)}] is whitespace-only — provide real content`);
        }
      }
    }
    if (room.sensory.tactile.trim().length === 0) {
      errors.push(`Room '${room.roomId}': sensory.tactile is whitespace-only — provide real content`);
    }
  }

  // Cross-room sound deduplication check (warn via repairs, don't fail)
  const soundsByRoom = new Map<string, string[]>();
  for (const room of output.rooms) {
    soundsByRoom.set(room.roomId, room.sensory.sounds.map(s => s.toLowerCase().trim()));
  }
  const allSoundsFlat: Array<{ roomId: string; sound: string }> = [];
  for (const [roomId, sounds] of soundsByRoom) {
    for (const sound of sounds) {
      allSoundsFlat.push({ roomId, sound });
    }
  }
  for (let i = 0; i < allSoundsFlat.length; i++) {
    for (let j = i + 1; j < allSoundsFlat.length; j++) {
      if (allSoundsFlat[i].roomId !== allSoundsFlat[j].roomId &&
        allSoundsFlat[i].sound === allSoundsFlat[j].sound) {
        repairs.push(`Duplicate sound across rooms '${allSoundsFlat[i].roomId}' and '${allSoundsFlat[j].roomId}': "${allSoundsFlat[i].sound}"`);
      }
    }
  }

  if (errors.length > 0) {
    return validationFailure(errors);
  }

  // Assemble validated results in topology order
  const results: RoomMechanicalResult[] = topology.rooms.map(topoRoom => {
    const outputRoom = output.rooms.find(r => r.roomId === topoRoom.id);
    const fallbackName = roomFallbackName(topoRoom.archetype, topoRoom.id);

    return {
      roomId: topoRoom.id,
      name: outputRoom?.name || fallbackName,
      engineeringNotes: outputRoom?.engineeringNotes ?? '',
      sensory: {
        sounds: outputRoom?.sensory.sounds ?? [],
        smells: outputRoom?.sensory.smells ?? [],
        visuals: outputRoom?.sensory.visuals ?? [],
        tactile: outputRoom?.sensory.tactile ?? '',
      },
    };
  });

  return validationSuccess<RoomMechanicalResult[]>(results, repairs);
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const roomMechanicalBatchLayer: LayerConfig<RoomMechanicalBatchOutput, RoomMechanicalResult[]> = {
  name: 'Creative/RoomMechanical',
  schema: RoomMechanicalBatchSchema,
  buildPrompt: buildRoomMechanicalBatchPrompt,
  validate: validateRoomMechanicalBatch,
  maxRetries: 2,
  timeoutMs: 120_000,
  maxOutputTokens: 8192,
  summarize: (v) => `${String(v.length)} rooms with mechanical content`,
};
