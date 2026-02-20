import type { GameSegment } from './types';

/**
 * Streaming JSON segment extractor for structured Game Master output.
 *
 * Extracts complete `GameSegment` objects from incremental JSON deltas
 * using brace-depth tracking. O(n) total across all deltas.
 *
 * Ported from src/json-stream-parser.ts for browser use.
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
