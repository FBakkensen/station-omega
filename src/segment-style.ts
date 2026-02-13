import {
    StyledText,
    bold,
    italic,
    dim,
    fg,
    strikethrough,
} from '@opentui/core';
import type { TextChunk } from '@opentui/core';
import type { DisplaySegment } from './schema.js';
import { flattenMarkdown, type ContentRun } from './markdown-reveal.js';

// ─── Segment Type Colors ─────────────────────────────────────────────────────

/** Per-segment-type text color palettes. */
const SEGMENT_COLORS = {
    narration: '#d0d8e0',
    dialogue: '#e8d8c0',
    thought: '#8abfff',
    station_pa: '#ff8844',
    crew_echo: '#6aad8a',
    diagnostic_readout: '#44ddaa',
} as const;

/** Per-segment-type header colors. */
const HEADER_COLORS = {
    narration: '#7a8a9a',
    dialogue: '#4a9acc',
    thought: '#b08adf',
    station_pa: '#3a8a3a',
    crew_echo: '#7a5a8a',
    diagnostic_readout: '#22aa88',
} as const;

// ─── Card Styling ────────────────────────────────────────────────────────────

export interface CardStyle {
    bgColor: string;
    borderColor?: string;
    borderStyle?: 'single' | 'rounded';
}

/** Return card background and optional border config for a segment type. */
export function segmentCardStyle(type: DisplaySegment['type']): CardStyle {
    switch (type) {
        case 'narration':
            return { bgColor: '#243348', borderColor: '#3a5068', borderStyle: 'rounded' };
        case 'dialogue':
            return { bgColor: '#2a3040', borderColor: '#4a7aaa', borderStyle: 'single' };
        case 'thought':
            return { bgColor: '#1e2838', borderColor: '#8a6abf', borderStyle: 'rounded' };
        case 'station_pa':
            return { bgColor: '#1a2a1a', borderColor: '#3a8a3a', borderStyle: 'single' };
        case 'crew_echo':
            return { bgColor: '#2a2530', borderColor: '#7a5a8a', borderStyle: 'rounded' };
        case 'diagnostic_readout':
            return { bgColor: '#0a2020', borderColor: '#22aa88', borderStyle: 'single' };
    }
}

// ─── Markdown Run → TextChunk Mapping ────────────────────────────────────────

/**
 * Convert a ContentRun (from flattenMarkdown) to a TextChunk with the
 * appropriate styles applied based on format context and segment type color.
 */
function runToChunk(run: ContentRun, baseColor: string): TextChunk {
    let chunk: TextChunk = fg(baseColor)(run.text);

    for (const fmt of run.formats) {
        switch (fmt.type) {
            case 'strong':
                chunk = bold(chunk);
                break;
            case 'em':
                chunk = italic(chunk);
                break;
            case 'del':
                chunk = strikethrough(chunk);
                break;
            case 'codespan':
                chunk = fg('#ff8844')(chunk);
                break;
        }
    }

    return chunk;
}

// ─── Header Construction ─────────────────────────────────────────────────────

/** Build header TextChunks for a segment (empty array for narration). */
function buildHeaderChunks(seg: DisplaySegment): TextChunk[] {
    switch (seg.type) {
        case 'narration':
            return [dim(fg(HEADER_COLORS.narration)('\u2726')), fg('#5a6a7a')('\n')];
        case 'dialogue': {
            const name = seg.speakerName ?? 'Unknown';
            return [bold(fg(HEADER_COLORS.dialogue)(name)), fg('#5a6a7a')('\n')];
        }
        case 'thought':
            return [italic(fg(HEADER_COLORS.thought)('\u00AB Thinking... \u00BB')), fg('#5a6a7a')('\n')];
        case 'station_pa':
            return [bold(fg(HEADER_COLORS.station_pa)('[STATION PA]')), fg('#5a6a7a')('\n')];
        case 'crew_echo': {
            const name = seg.speakerName ?? seg.crewName ?? 'Unknown';
            return [dim(fg(HEADER_COLORS.crew_echo)(`\u25B6 ${name}`)), fg('#5a6a7a')('\n')];
        }
        case 'diagnostic_readout':
            return [bold(fg(HEADER_COLORS.diagnostic_readout)('[DIAGNOSTIC]')), fg('#5a6a7a')('\n')];
    }
}

// ─── Main Conversion ─────────────────────────────────────────────────────────

/**
 * Convert a DisplaySegment to pre-styled TextChunk[].
 *
 * This parses inline markdown (bold, italic, code) ONCE using flattenMarkdown,
 * then maps each run to a TextChunk with the segment's base color and format
 * attributes. Header chunks (speaker name, prefix icons) are prepended for
 * non-narration types.
 *
 * The resulting chunks are cached and only need character-level truncation for
 * typewriter reveal — no markdown re-parsing per frame.
 */
export function segmentToStyledChunks(seg: DisplaySegment): TextChunk[] {
    const baseColor = SEGMENT_COLORS[seg.type];
    const { runs } = flattenMarkdown(seg.text);

    const headerChunks = buildHeaderChunks(seg);
    const bodyChunks = runs.map(run => runToChunk(run, baseColor));

    return [...headerChunks, ...bodyChunks];
}

/** Count total visible characters in a TextChunk array. */
export function countChunkChars(chunks: TextChunk[]): number {
    let total = 0;
    for (const chunk of chunks) {
        total += chunk.text.length;
    }
    return total;
}

/** Count visible characters in header chunks for a segment (0 for narration). */
export function getHeaderCharCount(seg: DisplaySegment): number {
    return countChunkChars(buildHeaderChunks(seg));
}

// ─── Typewriter Truncation ───────────────────────────────────────────────────

/**
 * Truncate a TextChunk array to at most `charLimit` visible characters.
 * Returns a new array with the last chunk possibly sliced. O(n-chunks).
 *
 * This is the hot path for typewriter reveal — called ~30 times/sec per active
 * card, but only iterates chunks (typically 2-10 per segment), not characters.
 */
export function truncateChunks(chunks: TextChunk[], charLimit: number): TextChunk[] {
    if (charLimit <= 0) return [];

    const result: TextChunk[] = [];
    let remaining = charLimit;

    for (const chunk of chunks) {
        if (remaining <= 0) break;

        if (chunk.text.length <= remaining) {
            result.push(chunk);
            remaining -= chunk.text.length;
        } else {
            // Clone chunk with truncated text
            result.push({ ...chunk, text: chunk.text.slice(0, remaining) });
            remaining = 0;
        }
    }

    return result;
}

/** Create a StyledText from a TextChunk array (convenience wrapper). */
export function chunksToStyledText(chunks: TextChunk[]): StyledText {
    return new StyledText(chunks);
}
