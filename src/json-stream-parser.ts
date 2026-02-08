import type { GameSegment } from './schema.js';

/**
 * Streaming JSON segment extractor for structured Game Master output.
 *
 * Extracts complete `GameSegment` objects from incremental JSON deltas
 * using brace-depth tracking:
 *
 * 1. Accumulates JSON text from `output_text_delta` events
 * 2. Detects `"segments":[` to know we're inside the array
 * 3. Tracks brace depth (`{` = +1, `}` = -1), respecting string escaping
 * 4. When depth drops from 2→1, a complete segment `{...}` has been emitted
 * 5. Extracts and `JSON.parse()`s each segment immediately
 *
 * O(n) total across all deltas — each character scanned exactly once.
 */
export class StreamingSegmentParser {
    private buffer = '';
    private insideArray = false;
    private braceDepth = 0;
    private inString = false;
    private escaped = false;
    private objectStart = -1;
    private scanPos = 0;

    /** Push a streaming delta. Returns any complete segments extracted. */
    push(delta: string): GameSegment[] {
        this.buffer += delta;
        const segments: GameSegment[] = [];

        while (this.scanPos < this.buffer.length) {
            const ch = this.buffer[this.scanPos];

            // Handle string escaping
            if (this.escaped) {
                this.escaped = false;
                this.scanPos++;
                continue;
            }

            if (this.inString) {
                if (ch === '\\') {
                    this.escaped = true;
                } else if (ch === '"') {
                    this.inString = false;
                }
                this.scanPos++;
                continue;
            }

            // Outside strings
            if (ch === '"') {
                this.inString = true;
                this.scanPos++;
                continue;
            }

            // Detect entry into segments array
            if (!this.insideArray && ch === '[') {
                // Check if the preceding text contains "segments"
                const preceding = this.buffer.slice(0, this.scanPos);
                if (preceding.includes('"segments"')) {
                    this.insideArray = true;
                    this.braceDepth = 0;
                }
                this.scanPos++;
                continue;
            }

            if (this.insideArray) {
                if (ch === '{') {
                    this.braceDepth++;
                    if (this.braceDepth === 1) {
                        this.objectStart = this.scanPos;
                    }
                } else if (ch === '}') {
                    this.braceDepth--;
                    if (this.braceDepth === 0 && this.objectStart !== -1) {
                        // Complete segment object
                        const json = this.buffer.slice(this.objectStart, this.scanPos + 1);
                        try {
                            const seg = JSON.parse(json) as GameSegment;
                            segments.push(seg);
                        } catch {
                            // Malformed segment — skip
                        }
                        this.objectStart = -1;
                    }
                } else if (ch === ']' && this.braceDepth === 0) {
                    // End of segments array
                    this.insideArray = false;
                }
            }

            this.scanPos++;
        }

        return segments;
    }

    /** Reset parser state for the next response. */
    reset(): void {
        this.buffer = '';
        this.insideArray = false;
        this.braceDepth = 0;
        this.inString = false;
        this.escaped = false;
        this.objectStart = -1;
        this.scanPos = 0;
    }
}
