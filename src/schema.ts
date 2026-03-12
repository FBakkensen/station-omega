import { z } from 'zod';

export const SEGMENT_TYPES = [
    'narration', 'dialogue', 'thought', 'station_pa', 'crew_echo', 'diagnostic_readout',
] as const;

export const GameSegmentSchema = z.object({
    type: z.enum(SEGMENT_TYPES),
    text: z.string(),
    npcId: z.string().nullable().describe('Legacy field. Always set to null.'),
    crewName: z.string().nullable().describe('Crew member full name from the crew roster, or null'),
    entityRefs: z.array(z.object({
      type: z.enum(['room', 'item']),
      id: z.string(),
    })).max(3).optional().describe('Up to 3 room or item references for inline thumbnail images, or omitted'),
});

export const GameResponseSchema = z.object({
    segments: z.array(GameSegmentSchema),
    imagePrompt: z.string().nullable().describe(
      'Flux Schnell image prompt for the current room scene (40-80 words), or null if room did not change'
    ),
});

export type GameSegment = z.infer<typeof GameSegmentSchema>;
export type GameResponse = z.infer<typeof GameResponseSchema>;
export type EntityRef = { type: 'room' | 'item'; id: string };

/** A GameSegment enriched with display metadata for client rendering. */
export interface DisplaySegment extends GameSegment {
    /** Resolved display name for the segment header (narrator callsign, NPC name, crew name, etc.). */
    speakerName: string | null;
    /** Index of this segment within the current AI response (0-based). */
    segmentIndex: number;
    /** Mission elapsed time string (e.g. "T+02:30") for thought segment headers. */
    missionTime?: string;
}
