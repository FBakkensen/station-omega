import { z } from 'zod';

export const GameSegmentSchema = z.object({
    type: z.enum(['narration', 'dialogue', 'thought', 'station_pa', 'crew_echo', 'diagnostic_readout']),
    text: z.string(),
    npcId: z.string().nullable().describe('NPC internal ID from the NPC list (e.g. "enemy_room_1"), or null'),
    crewName: z.string().nullable().describe('Crew member full name from the crew roster, or null'),
});

export const GameResponseSchema = z.object({
    segments: z.array(GameSegmentSchema),
});

export type GameSegment = z.infer<typeof GameSegmentSchema>;
export type GameResponse = z.infer<typeof GameResponseSchema>;

/** A GameSegment enriched with display metadata for the TUI card system. */
export interface DisplaySegment extends GameSegment {
    /** Resolved display name for the speaker (NPC name, crew name, etc.), or null for narration. */
    speakerName: string | null;
    /** Index of this segment within the current AI response (0-based). */
    segmentIndex: number;
}

/** Convert a GameSegment to markdown text for TTS display-text tracking. */
export function segmentToMarkdown(seg: GameSegment): string {
    switch (seg.type) {
        case 'narration':
            return seg.text;
        case 'dialogue':
            return `\u2014 "${seg.text}"`;
        case 'thought':
            return `*\u00AB ${seg.text} \u00BB*`;
        case 'station_pa':
            return `\`[STATION] ${seg.text}\``;
        case 'crew_echo':
            return `> **${seg.crewName ?? 'Unknown'}**: "${seg.text}"`;
        case 'diagnostic_readout':
            return `\`[DIAGNOSTIC] ${seg.text}\``;
    }
}
