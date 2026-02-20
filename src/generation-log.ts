/**
 * Generation logger using console.log.
 *
 * All logs appear in the Convex dashboard (server-side) or terminal (local dev).
 * Structured prefix format: [gen:difficulty/class] [LABEL] content
 */

export interface GenerationLogger {
    log(label: string, content: string): void;
    finalize(stationName: string): void;
}

class ConsoleGenerationLogger implements GenerationLogger {
    private readonly prefix: string;

    constructor(difficulty: string, characterClass: string) {
        this.prefix = `[gen:${difficulty}/${characterClass}]`;
        console.log(this.prefix, 'Generation log started');
    }

    log(label: string, content: string): void {
        // Truncate very long content (AI responses) to keep logs readable
        const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
        console.log(this.prefix, `[${label}]`, truncated);
    }

    finalize(stationName: string): void {
        console.log(this.prefix, `[FINALIZED] Station: "${stationName}"`);
    }
}

export function createGenerationLogger(difficulty: string, characterClass: string): GenerationLogger {
    return new ConsoleGenerationLogger(difficulty, characterClass);
}
