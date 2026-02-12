/**
 * voice-test.ts — Standalone voice A/B test script for Inworld TTS-1.5-max
 *
 * Generates WAV samples across different voice/tuning/markup combinations
 * for each segment role, plus spectrogram PNGs for visual analysis.
 *
 * Usage:
 *   bun voice-test.ts              # Generate all samples
 *   bun voice-test.ts --role=thought  # Generate only one role
 *   bun voice-test.ts --skip-spectrograms  # Skip spectrogram generation
 *
 * Requires: INWORLD_API_KEY env var, ffmpeg installed
 * Output: voice-tests/ directory with WAVs and spectrogram PNGs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// ─── Inworld API Constants (mirrored from src/tts.ts) ───────────────────────

const INWORLD_API_BASE = 'https://api.inworld.ai/tts/v1';
const INWORLD_MODEL = 'inworld-tts-1.5-max';
const INWORLD_SAMPLE_RATE = 48000;
const INWORLD_BITS_PER_SAMPLE = 16;
const INWORLD_CHANNELS = 1;

// ─── Test Texts (Andy Weir style per segment type) ──────────────────────────

const TEST_TEXTS: Record<string, string> = {
    narrator: "The corridor stretches ahead, emergency lighting painting everything in that particular shade of institutional orange that says 'something went wrong here, but we had a budget for exit signs.' The air recycler is cycling at about twice normal speed. Compensating for a leak somewhere, probably.",
    thought: "Okay, let's math this out. Primary coolant pump is cavitating — air in the line, probably from the breach in section seven. If I can't bleed the line in the next six minutes, the thermal runaway hits about eight hundred degrees. That's the 'everything melts' kind of hot. No pressure.",
    station_pa: "Attention. Atmospheric processor offline in section four. Oxygen levels: eighteen point two percent and falling. Estimated breathable time: forty-seven minutes. Have a productive day.",
    diagnostic: "Coolant loop three: offline. Primary pump RPM: zero. Backup pump: degraded, operating at thirty-two percent capacity. Thermal gradient: increasing at zero point four degrees per minute.",
    crew_echo: "Replaced the number three relay for the third time this month. Whatever is causing the surge is upstream. I am going to trace the conduit tomorrow if maintenance ever gives me back my multimeter. Signed, Torres.",
};

// ─── Emotion Markup Variants ─────────────────────────────────────────────────

interface MarkupVariant {
    label: string;
    transform: (text: string) => string;
}

const MARKUP_VARIANTS: Record<string, MarkupVariant[]> = {
    narrator: [
        { label: 'baseline', transform: (t) => t },
        { label: 'laughing', transform: (t) => `[laughing] ${t}` },
    ],
    thought: [
        { label: 'baseline', transform: (t) => t },
        { label: 'sigh', transform: (t) => `[sigh] ${t}` },
        {
            label: 'emphasis',
            transform: (t) =>
                t
                    .replace('eight hundred', '*eight hundred*')
                    .replace('six minutes', '*six minutes*'),
        },
    ],
    station_pa: [
        { label: 'baseline', transform: (t) => t },
    ],
    diagnostic: [
        { label: 'baseline', transform: (t) => t },
    ],
    crew_echo: [
        { label: 'baseline', transform: (t) => t },
        { label: 'sigh', transform: (t) => `[sigh] ${t}` },
    ],
};

// ─── Voice Candidate Matrix ─────────────────────────────────────────────────

interface VoiceTestCase {
    voice: string;
    temp: number;
    rate: number;
}

const VOICE_CANDIDATES: Record<string, VoiceTestCase[]> = {
    narrator: [
        // Current: Shaun @ 1.1/1.0
        { voice: 'Shaun', temp: 1.0, rate: 1.0 },
        { voice: 'Shaun', temp: 1.2, rate: 1.0 },
        { voice: 'Shaun', temp: 1.5, rate: 1.0 },
        { voice: 'Craig', temp: 1.0, rate: 1.0 },
        { voice: 'Craig', temp: 1.2, rate: 1.0 },
        { voice: 'Craig', temp: 1.5, rate: 1.0 },
        { voice: 'Mark', temp: 1.0, rate: 1.0 },
        { voice: 'Mark', temp: 1.2, rate: 1.0 },
        { voice: 'Mark', temp: 1.5, rate: 1.0 },
        { voice: 'Theodore', temp: 1.0, rate: 1.0 },
        { voice: 'Theodore', temp: 1.2, rate: 1.0 },
        { voice: 'Theodore', temp: 1.5, rate: 1.0 },
        { voice: 'Ronald', temp: 1.0, rate: 1.0 },
        { voice: 'Ronald', temp: 1.2, rate: 1.0 },
        { voice: 'Ronald', temp: 1.5, rate: 1.0 },
        { voice: 'Edward', temp: 1.0, rate: 1.0 },
        { voice: 'Edward', temp: 1.2, rate: 1.0 },
        { voice: 'Edward', temp: 1.5, rate: 1.0 },
    ],
    thought: [
        // Current: Timothy @ 1.0/1.05
        { voice: 'Timothy', temp: 1.0, rate: 1.05 },
        { voice: 'Timothy', temp: 1.3, rate: 1.05 },
        { voice: 'Timothy', temp: 1.5, rate: 1.05 },
        { voice: 'Timothy', temp: 1.0, rate: 1.15 },
        { voice: 'Timothy', temp: 1.3, rate: 1.15 },
        { voice: 'Timothy', temp: 1.5, rate: 1.15 },
        { voice: 'Alex', temp: 1.0, rate: 1.05 },
        { voice: 'Alex', temp: 1.3, rate: 1.05 },
        { voice: 'Alex', temp: 1.5, rate: 1.05 },
        { voice: 'Alex', temp: 1.0, rate: 1.15 },
        { voice: 'Alex', temp: 1.3, rate: 1.15 },
        { voice: 'Alex', temp: 1.5, rate: 1.15 },
        { voice: 'Craig', temp: 1.0, rate: 1.05 },
        { voice: 'Craig', temp: 1.3, rate: 1.05 },
        { voice: 'Craig', temp: 1.5, rate: 1.05 },
        { voice: 'Craig', temp: 1.0, rate: 1.15 },
        { voice: 'Craig', temp: 1.3, rate: 1.15 },
        { voice: 'Craig', temp: 1.5, rate: 1.15 },
        { voice: 'Mark', temp: 1.0, rate: 1.05 },
        { voice: 'Mark', temp: 1.3, rate: 1.05 },
        { voice: 'Mark', temp: 1.5, rate: 1.05 },
        { voice: 'Mark', temp: 1.0, rate: 1.15 },
        { voice: 'Mark', temp: 1.3, rate: 1.15 },
        { voice: 'Mark', temp: 1.5, rate: 1.15 },
    ],
    station_pa: [
        // Current: Elizabeth @ 0.7/1.0
        { voice: 'Elizabeth', temp: 0.5, rate: 1.0 },
        { voice: 'Elizabeth', temp: 0.7, rate: 1.0 },
        { voice: 'Pixie', temp: 0.5, rate: 1.0 },
        { voice: 'Pixie', temp: 0.7, rate: 1.0 },
    ],
    diagnostic: [
        // Current: Elizabeth @ 0.6/1.1
        { voice: 'Elizabeth', temp: 0.4, rate: 1.1 },
        { voice: 'Elizabeth', temp: 0.6, rate: 1.1 },
        { voice: 'Elizabeth', temp: 0.4, rate: 1.2 },
        { voice: 'Elizabeth', temp: 0.6, rate: 1.2 },
        { voice: 'Pixie', temp: 0.4, rate: 1.1 },
        { voice: 'Pixie', temp: 0.6, rate: 1.1 },
        { voice: 'Pixie', temp: 0.4, rate: 1.2 },
        { voice: 'Pixie', temp: 0.6, rate: 1.2 },
    ],
    crew_echo: [
        { voice: 'Craig', temp: 1.0, rate: 1.0 },
        { voice: 'Craig', temp: 1.3, rate: 1.0 },
        { voice: 'Mark', temp: 1.0, rate: 1.0 },
        { voice: 'Mark', temp: 1.3, rate: 1.0 },
        { voice: 'Sarah', temp: 1.0, rate: 1.0 },
        { voice: 'Sarah', temp: 1.3, rate: 1.0 },
    ],
};

// ─── WAV Helpers (mirrored from src/tts.ts) ──────────────────────────────────

function createWavBuffer(rawAudio: Buffer, channels: number, sampleRate: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = rawAudio.byteLength;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, rawAudio]);
}

function parseWavDuration(buffer: Buffer): number {
    const byteRate = buffer.readUInt32LE(28);
    return (buffer.byteLength - 44) / byteRate;
}

// ─── Inworld API Call ────────────────────────────────────────────────────────

async function generateSpeech(
    apiKey: string,
    text: string,
    voiceId: string,
    temperature: number,
    speakingRate: number,
): Promise<Buffer> {
    const response = await fetch(`${INWORLD_API_BASE}/voice:stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
        },
        body: JSON.stringify({
            text,
            voice_id: voiceId,
            model_id: INWORLD_MODEL,
            audio_config: {
                audio_encoding: 'LINEAR16',
                sample_rate_hertz: INWORLD_SAMPLE_RATE,
                speaking_rate: speakingRate,
            },
            temperature,
        }),
    });

    if (!response.ok) {
        let details = '';
        try { details = await response.text(); } catch { /* ignore */ }
        throw new Error(`Inworld TTS HTTP ${String(response.status)}: ${details}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    const rawChunks: Buffer[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line) as { result?: { audioContent?: string } };
                if (parsed.result?.audioContent) {
                    const chunk = Buffer.from(parsed.result.audioContent, 'base64');
                    const isRiff = chunk.subarray(0, 4).toString() === 'RIFF';
                    if (isRiff && chunk.length > 44) {
                        rawChunks.push(chunk.subarray(44));
                    } else if (!isRiff) {
                        rawChunks.push(chunk);
                    }
                }
            } catch { /* skip malformed */ }
        }
    }

    // Process remaining buffer
    if (buffer.trim()) {
        try {
            const parsed = JSON.parse(buffer) as { result?: { audioContent?: string } };
            if (parsed.result?.audioContent) {
                const chunk = Buffer.from(parsed.result.audioContent, 'base64');
                if (chunk.length > 44 && chunk.subarray(0, 4).toString() === 'RIFF') {
                    rawChunks.push(chunk.subarray(44));
                } else {
                    rawChunks.push(chunk);
                }
            }
        } catch { /* skip */ }
    }

    const combinedAudio = Buffer.concat(rawChunks);
    return createWavBuffer(combinedAudio, INWORLD_CHANNELS, INWORLD_SAMPLE_RATE, INWORLD_BITS_PER_SAMPLE);
}

// ─── Spectrogram Generation ──────────────────────────────────────────────────

function generateSpectrogram(wavPath: string, pngPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', [
            '-y', '-i', wavPath,
            '-lavfi', 'showspectrumpic=s=800x200:mode=combined:color=intensity',
            pngPath,
        ], { stdio: 'ignore' });

        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg spectrogram exited with code ${String(code)}`));
        });
        proc.on('error', (err) => { reject(err); });
    });
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface TestResult {
    role: string;
    voice: string;
    temp: number;
    rate: number;
    markup: string;
    filename: string;
    duration: number;
    textLen: number;
}

async function main(): Promise<void> {
    const apiKey = process.env['INWORLD_API_KEY'];
    if (!apiKey) {
        console.error('ERROR: INWORLD_API_KEY environment variable is required');
        process.exit(1);
    }

    // Parse CLI args
    const args = process.argv.slice(2);
    const roleFilter = args.find(a => a.startsWith('--role='))?.split('=')[1] ?? null;
    const skipSpectrograms = args.includes('--skip-spectrograms');

    const outDir = join(process.cwd(), 'voice-tests');
    await mkdir(outDir, { recursive: true });

    const roles = roleFilter ? [roleFilter] : Object.keys(TEST_TEXTS);
    const results: TestResult[] = [];
    let totalSamples = 0;
    let generated = 0;

    // Count total samples
    for (const role of roles) {
        if (!(role in VOICE_CANDIDATES) || !(role in MARKUP_VARIANTS)) continue;
        const candidates = VOICE_CANDIDATES[role];
        const markups = MARKUP_VARIANTS[role];
        totalSamples += candidates.length * markups.length;
    }

    console.log(`\nVoice Test Generator — Inworld TTS-1.5-max`);
    console.log(`Generating ${String(totalSamples)} samples across ${String(roles.length)} role(s)\n`);

    for (const role of roles) {
        if (!(role in TEST_TEXTS) || !(role in VOICE_CANDIDATES) || !(role in MARKUP_VARIANTS)) {
            console.log(`  Skipping unknown role: ${role}`);
            continue;
        }
        const baseText = TEST_TEXTS[role];
        const candidates = VOICE_CANDIDATES[role];
        const markups = MARKUP_VARIANTS[role];

        console.log(`── ${role.toUpperCase()} ──`);

        for (const candidate of candidates) {
            for (const markup of markups) {
                const text = markup.transform(baseText);
                const filename = `${role}-${candidate.voice.toLowerCase()}-t${String(candidate.temp)}-s${String(candidate.rate)}${markup.label !== 'baseline' ? `-${markup.label}` : ''}.wav`;
                const wavPath = join(outDir, filename);

                generated++;
                const progress = `[${String(generated)}/${String(totalSamples)}]`;

                try {
                    process.stdout.write(`  ${progress} ${filename} ... `);
                    const wavBuffer = await generateSpeech(apiKey, text, candidate.voice, candidate.temp, candidate.rate);
                    await writeFile(wavPath, wavBuffer);
                    const duration = parseWavDuration(wavBuffer);

                    // Generate spectrogram
                    if (!skipSpectrograms) {
                        const pngPath = wavPath.replace('.wav', '.png');
                        try {
                            await generateSpectrogram(wavPath, pngPath);
                        } catch {
                            process.stdout.write('(spectrogram failed) ');
                        }
                    }

                    results.push({
                        role,
                        voice: candidate.voice,
                        temp: candidate.temp,
                        rate: candidate.rate,
                        markup: markup.label,
                        filename,
                        duration,
                        textLen: text.length,
                    });

                    console.log(`${duration.toFixed(1)}s`);
                } catch (err) {
                    console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        console.log('');
    }

    // ─── Summary Table ───────────────────────────────────────────────────────

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(' SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // Group by role
    const byRole = new Map<string, TestResult[]>();
    for (const r of results) {
        const list = byRole.get(r.role) ?? [];
        list.push(r);
        byRole.set(r.role, list);
    }

    for (const [role, roleResults] of byRole) {
        console.log(`── ${role.toUpperCase()} ──`);
        console.log(`  ${'Voice'.padEnd(12)} ${'Temp'.padEnd(6)} ${'Rate'.padEnd(6)} ${'Markup'.padEnd(12)} ${'Duration'.padEnd(10)} ${'Chars/sec'.padEnd(10)}`);
        console.log(`  ${'─'.repeat(12)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);

        // Sort by duration descending (longer = more pauses = potentially more natural)
        const sorted = [...roleResults].sort((a, b) => b.duration - a.duration);
        for (const r of sorted) {
            const charsPerSec = r.textLen / r.duration;
            console.log(
                `  ${r.voice.padEnd(12)} ${r.temp.toFixed(1).padEnd(6)} ${r.rate.toFixed(2).padEnd(6)} ${r.markup.padEnd(12)} ${r.duration.toFixed(1).padStart(6)}s    ${charsPerSec.toFixed(1).padStart(6)}`
            );
        }
        console.log('');
    }

    console.log(`Generated ${String(results.length)}/${String(totalSamples)} samples in voice-tests/`);
    if (!skipSpectrograms) {
        console.log('Spectrograms saved as .png files alongside each .wav');
    }
    console.log('\nTip: Sort by duration — longer durations often indicate more natural pacing with pauses.');
}

main().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
