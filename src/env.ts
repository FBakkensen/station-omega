import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Check if OPENROUTER_API_KEY is set in the environment. */
export function hasOpenRouterKey(): boolean {
    return !!process.env['OPENROUTER_API_KEY'];
}

/** Set the OpenRouter API key at runtime and persist to .env.local. */
export async function setOpenRouterKey(key: string): Promise<void> {
    process.env['OPENROUTER_API_KEY'] = key;
    await persistEnvVar('OPENROUTER_API_KEY', key);
}

/** Read/write a single env var into .env.local (upsert pattern). */
async function persistEnvVar(name: string, value: string): Promise<void> {
    const envPath = join(process.cwd(), '.env.local');
    try {
        let content = '';
        try {
            content = await readFile(envPath, 'utf-8');
        } catch {
            // File doesn't exist yet — start fresh
        }

        const line = `${name}=${value}`;
        const re = new RegExp(`^${name}=.*`, 'm');
        if (re.test(content)) {
            content = content.replace(re, () => line);
        } else {
            content = content.length > 0 && !content.endsWith('\n')
                ? `${content}\n${line}\n`
                : `${content}${line}\n`;
        }

        await writeFile(envPath, content, { mode: 0o600 });
    } catch {
        // Persistence failure should never break the game
    }
}
