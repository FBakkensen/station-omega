/**
 * Per-station generation log files.
 *
 * Each generateStation() call writes a dedicated log to generation-logs/
 * with full prompts, AI responses, validation results, repairs, and timing.
 * Oldest files are pruned when the directory reaches MAX_LOG_FILES.
 */

import { appendFileSync, renameSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = 'generation-logs';
const MAX_LOG_FILES = 20;

function ensureLogDir(): void {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}

/** Delete oldest .log files when count >= MAX_LOG_FILES. */
function pruneOldLogs(): void {
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort();
    while (files.length >= MAX_LOG_FILES) {
        const oldest = files.shift();
        if (!oldest) break;
        try { unlinkSync(join(LOG_DIR, oldest)); } catch { /* already gone */ }
    }
}

/** Slugify a station name for use in filenames. */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Windows-safe ISO timestamp (colons → dashes). */
function safeTimestamp(): string {
    return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
}

export class GenerationLogger {
    private filePath: string;

    constructor(difficulty: string, characterClass: string) {
        ensureLogDir();
        pruneOldLogs();

        const ts = safeTimestamp();
        const filename = `${ts}_${difficulty}_${characterClass}.log`;
        this.filePath = join(LOG_DIR, filename);

        const header = [
            `Station Generation Log`,
            `Started: ${new Date().toISOString()}`,
            `Difficulty: ${difficulty}  Character: ${characterClass}`,
            '═'.repeat(72),
            '',
        ].join('\n');
        appendFileSync(this.filePath, header);
    }

    log(label: string, content: string): void {
        const ts = new Date().toISOString();
        const entry = `[${ts}] [${label}]\n${content}\n${'─'.repeat(72)}\n`;
        appendFileSync(this.filePath, entry);
    }

    finalize(stationName: string): void {
        const ts = safeTimestamp();
        const slug = slugify(stationName);
        const newFilename = `${ts}_${slug}.log`;
        const newPath = join(LOG_DIR, newFilename);

        this.log('FINALIZED', `Station: "${stationName}"`);

        try {
            renameSync(this.filePath, newPath);
            this.filePath = newPath;
        } catch {
            // Rename failed (e.g. same path) — keep original filename
        }
    }
}

export function createGenerationLogger(difficulty: string, characterClass: string): GenerationLogger {
    return new GenerationLogger(difficulty, characterClass);
}
