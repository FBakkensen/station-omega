import { z } from 'zod';

export const GameSegmentSchema = z.object({
    type: z.enum(['narration', 'dialogue', 'thought', 'station_pa', 'crew_echo']),
    text: z.string(),
    npcId: z.string().nullable(),
    crewName: z.string().nullable(),
});

export const GameResponseSchema = z.object({
    segments: z.array(GameSegmentSchema),
});

export type GameSegment = z.infer<typeof GameSegmentSchema>;
export type GameResponse = z.infer<typeof GameResponseSchema>;

/** Convert a GameSegment to display-ready markdown for the TUI. */
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
    }
}
