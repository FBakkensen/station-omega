/**
 * Creative Sub-Layer: Identity Seed
 *
 * Fast initial call (~800 tokens) that generates cross-cutting data
 * needed by all other creative sub-layers: station name, briefing,
 * backstory, crew roster, and tone keywords.
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedTopology } from './topology.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const IdentitySeedSchema = z.object({
    stationName: z.string(),
    briefing: z.string(),
    backstory: z.string(),
    crewRoster: z.array(z.object({
        name: z.string(),
        role: z.string(),
        fate: z.string(),
    })),
    toneKeywords: z.array(z.string()),
    visualStyleSeed: z.string(),
    briefingVideoPrompt: z.string(),
});

type IdentitySeedOutput = z.infer<typeof IdentitySeedSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface ValidatedIdentitySeed {
    stationName: string;
    briefing: string;
    backstory: string;
    crewRoster: Array<{ name: string; role: string; fate: string }>;
    toneKeywords: string[];
    visualStyleSeed: string;
    briefingVideoPrompt: string;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildIdentitySeedPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;

    const system = `You are a creative writer generating the identity and backstory for a derelict space station in a sci-fi engineering survival game.

# Style

Grounded sci-fi with personality. The Martian meets Project Hail Mary. The station is falling apart — systems are the antagonist, not creatures.

# Rules

- stationName: A practical designation — the kind of name a space agency would give a station (e.g., "Erebus Station", "Orbital Platform Kepler-7", "Deep Survey Relay Theta")
- briefing: 1-2 sentences summarizing the mission/situation
- backstory: 2-3 sentences about the station's history and what went wrong
- crewRoster: 3-5 crew members (engineers, scientists, technicians) with name, role, and fate
- toneKeywords: 3-5 words/phrases capturing the station's mood (e.g., "claustrophobic", "jury-rigged", "fading hope")
- visualStyleSeed: A short visual style phrase (10-20 words) describing the station's aesthetic for AI image generation. Focus on lighting, color palette, architectural style, and atmosphere (e.g., "Soviet-era brutalist industrial, amber emergency lighting, corroded steel panels", "Sleek corporate white corridors stained with coolant, flickering fluorescent strips")
- briefingVideoPrompt: A CCTV security camera video prompt (30-60 words) for a 5-second surveillance footage clip, optimized for Seedance text-to-video. This video plays when the player opens the Mission Objectives screen — it must visually convey the SPECIFIC mission and its stakes through security camera footage. CRITICAL: the scene must be nearly STATIC — a frozen moment captured by a security camera. No moving objects, no flickering, no phasing, no spinning, no dynamic action. Only subtle ambient details like dripping liquid, drifting smoke, or a blinking light are allowed. Structure: fixed camera position first (overhead, wall-mounted, corner-mounted), then STILL visual details showing the aftermath of what went wrong (damage, debris, warning signs), then CCTV artifacts (timestamp overlay, scan lines, low-resolution grain, slight static). No audio cues. Example for a comms relay repair mission: "Fixed overhead security camera, wide angle. A darkened communications hub with severed data cables hanging over flooded deck plates. Dead relay terminals line the walls. A cracked monitor displays a distress signal waveform. CCTV timestamp overlay, scan lines, low-resolution grain."`;

    const roomSummary = topology.rooms.map(r => `  ${r.id} (${r.archetype})`).join('\n');

    let user = `Generate identity content for this station:

Scenario: ${topology.scenario.theme} — ${topology.scenario.centralTension}
Topology: ${topology.topology}
Character: ${context.characterClass}
Difficulty: ${context.difficulty}

Rooms (${String(topology.rooms.length)} total):
${roomSummary}

Entry: ${topology.entryRoomId}
Escape: ${topology.escapeRoomId}`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateIdentitySeed(output: IdentitySeedOutput, _context: LayerContext): ValidationResult<ValidatedIdentitySeed> {
    const errors: string[] = [];

    if (!output.stationName.trim()) {
        errors.push('stationName is empty — provide a station designation');
    }

    if (output.crewRoster.length < 3) {
        errors.push(`Crew roster has ${String(output.crewRoster.length)} members — generate at least 3`);
    }

    if (output.toneKeywords.length < 3 || output.toneKeywords.length > 5) {
        errors.push(`toneKeywords has ${String(output.toneKeywords.length)} entries — provide exactly 3-5`);
    }

    if (!output.briefing.trim()) {
        errors.push('briefing is empty — provide a 1-2 sentence mission summary');
    }

    if (!output.backstory.trim()) {
        errors.push('backstory is empty — provide a 2-3 sentence station history');
    }

    if (!output.visualStyleSeed.trim()) {
        errors.push('visualStyleSeed is empty — provide a 10-20 word visual style phrase');
    }

    if (!output.briefingVideoPrompt.trim()) {
        errors.push('briefingVideoPrompt is empty — provide a 30-60 word video prompt');
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    return validationSuccess<ValidatedIdentitySeed>({
        stationName: output.stationName,
        briefing: output.briefing,
        backstory: output.backstory,
        crewRoster: output.crewRoster.map(c => ({
            name: c.name,
            role: c.role,
            fate: c.fate,
        })),
        toneKeywords: output.toneKeywords,
        visualStyleSeed: output.visualStyleSeed,
        briefingVideoPrompt: output.briefingVideoPrompt,
    });
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const identitySeedLayer: LayerConfig<IdentitySeedOutput, ValidatedIdentitySeed> = {
    name: 'Creative/Identity',
    schema: IdentitySeedSchema,
    buildPrompt: buildIdentitySeedPrompt,
    validate: validateIdentitySeed,
    maxRetries: 2,
    timeoutMs: 60_000,
    maxOutputTokens: 2048,
    summarize: (v) => {
        const crewNames = v.crewRoster.map(c => c.name);
        return [
            `Station: "${v.stationName}"`,
            `Crew: ${crewNames.join(', ')}`,
            `Tone: ${v.toneKeywords.join(', ')}`,
            `Visual: ${v.visualStyleSeed}`,
            `Video: ${v.briefingVideoPrompt.slice(0, 60)}…`,
        ].join('\n');
    },
};
