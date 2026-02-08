import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import OpenAI from 'openai';
import type { NPC, CrewMember } from './types.js';
import { extractCleanText } from './markdown-reveal.js';
import type { GameSegment } from './schema.js';

// ─── Errors ────────────────────────────────────────────────────────────────

export class TTSError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TTSError';
    }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NarratorContext {
    inCombat: boolean;
    hpPercent: number;
    isNewRoom: boolean;
}

type OpenAIVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable'
    | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

interface VoiceConfig {
    voice: OpenAIVoice;
    instructions: string;
}

interface SpeechChunk {
    text: string;
    charBudget: number;
    voice: OpenAIVoice;
    instructions: string;
    index: number;
    segmentIndex: number;
}

interface GeneratedWav {
    filePath: string;
    index: number;
    charBudget: number;
    audioDuration: number;
    segmentIndex: number;
}

// ─── Voice Pool ────────────────────────────────────────────────────────────

const NARRATOR_VOICE: OpenAIVoice = 'cedar';
const NARRATOR_INSTRUCTIONS = 'You are narrating a sci-fi horror text adventure set on an abandoned space station. Speak with a warm but measured tone, building tension through pacing. Use deliberate pauses before revealing dangers. Keep a steady, grounded delivery — authoritative but not theatrical.';

const NPC_VOICE_POOL: OpenAIVoice[] = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
    'nova', 'sage', 'shimmer', 'verse', 'marin',
];

const BOSS_VOICE: OpenAIVoice = 'onyx';

const INNER_VOICE: OpenAIVoice = 'shimmer';
const INNER_VOICE_INSTRUCTIONS = 'You are the player\'s inner voice. Soft, ethereal, almost dreamlike. A breathy near-whisper, slow cadence, pause between phrases. Maximum contrast with the grounded narrator.';

const STATION_PA_VOICE: OpenAIVoice = 'echo';
const STATION_PA_INSTRUCTIONS = 'Station public address system. Flat monotone, micro-pauses between words, zero inflection. A machine reading an obituary.';

const CREW_ECHO_INSTRUCTIONS = 'You are a recorded crew log, played through a crackling speaker. Audio is compressed and distant, with faint static. Speak with the tired resignation of someone who knew the end was near.';

const NARRATOR_MOODS: Record<string, string> = {
    combat: 'Urgent, intense narration. Short punchy delivery. Breathless pacing. Every beat lands like a blow.',
    wounded: 'Strained, fragile narration. Words come with effort. Quiet, intimate. The narrator sounds hurt.',
    discovery: 'Quiet wonder in the narration. Careful observation. A hint of awe at something new and unknown.',
    default: NARRATOR_INSTRUCTIONS,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Simple deterministic hash of a string to a positive integer. */
function hashString(s: string): number {
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/** Remove markdown formatting so TTS reads clean text. Uses token-based extraction with safety fallback. */
function stripMarkdown(text: string): string {
    return extractCleanText(text)
        .replace(/\u2800/g, '')               // Braille Pattern Blank spacers
        .replace(/[*_~`]/g, '')               // safety: lone formatting chars from chunk splits
        .trim();
}

/** Split text into chunks of roughly `maxLen` characters at sentence boundaries. */
function splitLongText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
        // Find the last sentence boundary within maxLen
        let splitAt = -1;
        for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
            const idx = remaining.lastIndexOf(sep, maxLen);
            if (idx > splitAt) splitAt = idx + sep.length;
        }
        // Fallback to space if no sentence boundary found
        if (splitAt <= 0) {
            splitAt = remaining.lastIndexOf(' ', maxLen);
        }
        if (splitAt <= 0) splitAt = maxLen;

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

/** Parse WAV header to compute audio duration in seconds. */
function parseWavDuration(buffer: Buffer): number {
    // Byte rate at offset 28 is always valid, even in streaming WAVs where
    // the data-size field (offset 40) is 0xFFFFFFFF.
    const byteRate = buffer.readUInt32LE(28);
    return (buffer.byteLength - 44) / byteRate;
}

/** Sentence-end boundary: punctuation followed by whitespace or end-of-string. */
const SENTENCE_END_RE = /[.!?](?:\s|$)/;

// ─── TTS Engine ────────────────────────────────────────────────────────────

const DEFAULT_CHARS_PER_SEC = 25;

interface TTSEngineOptions {
    debugLog?: (label: string, content: string) => void;
}

export class TTSEngine {
    private openai: OpenAI | null = null;
    private streamId = 0;
    private audioEnabled = false;
    private debugLog: (label: string, content: string) => void;
    private npcMap = new Map<string, NPC>();
    private crewRoster: CrewMember[] = [];
    private narratorContext: NarratorContext = { inCombat: false, hpPercent: 100, isNewRoom: false };
    private tempDir: string | null = null;
    private currentProcess: ChildProcess | null = null;
    private abortController: AbortController | null = null;
    private silentPauseTimer: ReturnType<typeof setTimeout> | null = null;
    private silentPauseResolve: (() => void) | null = null;

    // ─── Error accumulation ────────────────────────────────────────────────
    private pipelineError: TTSError | null = null;

    // ─── Streaming pipeline state ─────────────────────────────────────────
    private chunkQueue: SpeechChunk[] = [];
    private wavQueue: GeneratedWav[] = [];
    private nextChunkIndex = { value: 0 };
    private segmentCounter = 0;
    private nextPlayIndex = 0;
    private generationRunning = false;
    private playbackRunning = false;
    private streamAborted = false;
    private streamComplete = false;
    private generationPromise: Promise<void> | null = null;
    private playbackPromise: Promise<void> | null = null;
    private streamActive = false;

    /** Called when a chunk should be revealed in the UI. Set by the game loop. */
    onRevealChunk: ((segmentIndex: number, charBudget: number, durationSec: number) => void) | null = null;

    constructor(options: TTSEngineOptions = {}) {
        this.debugLog = options.debugLog ?? (() => { /* no-op */ });
    }

    /** Verify ffplay is installed and accessible. */
    private async checkFfplay(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const proc = spawn('ffplay', ['-version'], { stdio: 'ignore' });
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new TTSError(`ffplay exited with code ${String(code)}. Install ffmpeg to enable TTS audio.`));
            });
            proc.on('error', () => {
                reject(new TTSError('ffplay not found. Install ffmpeg to enable TTS audio.'));
            });
        });
    }

    async init(): Promise<void> {
        // Always create temp directory (needed for audio WAV files when enabled)
        this.tempDir = await mkdtemp(join(tmpdir(), 'station-omega-tts-'));

        // Try to set up audio — if anything fails, we stay in silent typewriter mode
        if (!process.env['OPENAI_API_KEY']) {
            this.debugLog('TTS', 'No OPENAI_API_KEY — running in silent typewriter mode');
            return;
        }

        try {
            this.openai = new OpenAI();
            await this.checkFfplay();
            this.audioEnabled = true;
            this.debugLog('TTS', `Initialized OpenAI TTS client. Temp dir: ${this.tempDir}`);
        } catch (err: unknown) {
            this.openai = null;
            this.audioEnabled = false;
            this.debugLog('TTS', `Audio unavailable (${String(err)}) — running in silent typewriter mode`);
        }
    }

    /** Generate speech via OpenAI gpt-4o-mini-tts and save to a WAV file. */
    private async generateWithOpenAI(chunk: SpeechChunk): Promise<GeneratedWav | null> {
        if (!this.openai || !this.tempDir) return null;

        try {
            this.abortController = new AbortController();
            const response = await this.openai.audio.speech.create(
                {
                    model: 'gpt-4o-mini-tts',
                    voice: chunk.voice,
                    input: chunk.text,
                    instructions: chunk.instructions,
                    response_format: 'wav',
                },
                { signal: this.abortController.signal },
            );

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const filePath = join(this.tempDir, `tts-${String(this.streamId)}-${String(chunk.index)}.wav`);
            await writeFile(filePath, buffer);

            const audioDuration = parseWavDuration(buffer);

            this.abortController = null;
            return { filePath, index: chunk.index, charBudget: chunk.charBudget, audioDuration, segmentIndex: chunk.segmentIndex };
        } catch (err: unknown) {
            this.abortController = null;
            // Don't treat abort as an error
            if (err instanceof Error && err.name === 'AbortError') return null;
            throw err;
        }
    }

    setNPCs(npcs: Map<string, NPC>): void {
        this.npcMap.clear();
        for (const [id, npc] of npcs) {
            this.npcMap.set(id, npc);
        }
    }

    private getVoiceConfigForNPC(npcId: string): VoiceConfig {
        const npc = this.npcMap.get(npcId);

        // Tier-4 bosses always use the boss voice
        if (npc?.tier === 4) {
            return {
                voice: BOSS_VOICE,
                instructions: this.buildNPCInstructions(npc),
            };
        }

        // Deterministic hash into the NPC voice pool
        const idx = hashString(npcId) % NPC_VOICE_POOL.length;
        return {
            voice: NPC_VOICE_POOL[idx],
            instructions: npc ? this.buildNPCInstructions(npc) : 'Speak as a space station crew member in a sci-fi horror setting.',
        };
    }

    /** Build voice steering instructions from NPC personality and sound signature. */
    private buildNPCInstructions(npc: NPC): string {
        const parts: string[] = [];

        // Tier-based delivery hints
        switch (npc.tier) {
            case 4:
                parts.push('You are a powerful boss creature. Speak with deep menace, authority, and terrifying presence. Use slow, deliberate pacing.');
                break;
            case 3:
                parts.push('You are an aggressive, dangerous creature. Speak with intensity and hostility. Your voice should convey threat and violence.');
                break;
            case 2:
                parts.push('You are a threatening presence on an abandoned space station. Speak with tension and unease.');
                break;
            default:
                parts.push('You are a creature or character on an abandoned space station. Speak with an unsettling quality.');
                break;
        }

        if (npc.personality) {
            parts.push(`Character: ${npc.personality}`);
        }

        if (npc.soundSignature) {
            parts.push(`Voice quality: ${npc.soundSignature}`);
        }

        return parts.join(' ');
    }

    setCrewRoster(roster: CrewMember[]): void {
        this.crewRoster = roster;
    }

    setNarratorContext(ctx: NarratorContext): void {
        this.narratorContext = ctx;
    }

    private getCrewEchoConfig(crewName: string): VoiceConfig {
        // Deterministic hash into the NPC voice pool (same pool, different base string)
        const idx = hashString(`crew_${crewName}`) % NPC_VOICE_POOL.length;
        const voice = NPC_VOICE_POOL[idx];

        // Find crew member info for steering
        const member = this.crewRoster.find(c => c.name === crewName);
        const parts: string[] = [CREW_ECHO_INSTRUCTIONS];
        if (member) {
            parts.push(`You are ${member.name}, ${member.role}. Your fate: ${member.fate}.`);
        } else {
            parts.push(`You are ${crewName}, a crew member of this station.`);
        }

        return { voice, instructions: parts.join(' ') };
    }

    /** Select the narrator mood based on current game context. */
    private getNarratorMood(): string {
        if (this.narratorContext.inCombat) return NARRATOR_MOODS['combat'];
        if (this.narratorContext.hpPercent < 25) return NARRATOR_MOODS['wounded'];
        if (this.narratorContext.isNewRoom) return NARRATOR_MOODS['discovery'];
        return NARRATOR_MOODS['default'];
    }

    /** Get voice config for a GameSegment. */
    private getVoiceConfigForSegment(seg: GameSegment): VoiceConfig {
        switch (seg.type) {
            case 'dialogue': {
                if (seg.npcId) {
                    return this.getVoiceConfigForNPC(seg.npcId);
                }
                return { voice: NARRATOR_VOICE, instructions: this.getNarratorMood() };
            }
            case 'thought':
                return { voice: INNER_VOICE, instructions: INNER_VOICE_INSTRUCTIONS };
            case 'station_pa':
                return { voice: STATION_PA_VOICE, instructions: STATION_PA_INSTRUCTIONS };
            case 'crew_echo': {
                if (seg.crewName) {
                    return this.getCrewEchoConfig(seg.crewName);
                }
                return { voice: NARRATOR_VOICE, instructions: CREW_ECHO_INSTRUCTIONS };
            }
            default:
                return { voice: NARRATOR_VOICE, instructions: this.getNarratorMood() };
        }
    }

    // ─── Streaming API ────────────────────────────────────────────────────

    /** Reset state and prepare for a new streaming response. */
    beginStream(): void {
        if (!this.tempDir) {
            throw new TTSError('beginStream() called but TTS engine is not initialized (call init() first)');
        }

        this.streamId++;
        this.streamAborted = false;
        this.streamComplete = false;
        this.chunkQueue = [];
        this.wavQueue = [];
        this.nextChunkIndex = { value: 0 };
        this.segmentCounter = 0;
        this.nextPlayIndex = 0;
        this.generationPromise = null;
        this.playbackPromise = null;
        this.streamActive = true;

        this.debugLog('TTS-STREAM', 'Stream started');
    }

    /** Feed a complete GameSegment into the TTS pipeline. */
    pushSegment(seg: GameSegment, bodyChars: number): void {
        if (this.streamAborted || !this.streamActive) return;

        // Always increment counter to stay aligned with UI card indices
        const segIdx = this.segmentCounter++;

        const clean = stripMarkdown(seg.text);
        if (!clean) return;

        const { voice, instructions } = this.getVoiceConfigForSegment(seg);

        const parts = splitLongText(clean, 500);
        const validParts = parts.filter(p => p.trim() && (SENTENCE_END_RE.test(p) || p.length >= 20));

        // Distribute body char budget proportionally across chunks
        let budgetUsed = 0;
        for (let i = 0; i < validParts.length; i++) {
            const part = validParts[i];
            const isLast = i === validParts.length - 1;
            const ratio = part.length / Math.max(clean.length, 1);
            const chunkBudget = isLast
                ? bodyChars - budgetUsed
                : Math.round(bodyChars * ratio);
            budgetUsed += chunkBudget;
            this.chunkQueue.push({
                text: part,
                charBudget: chunkBudget,
                voice,
                instructions,
                index: this.nextChunkIndex.value++,
                segmentIndex: segIdx,
            });
        }

        this.debugLog('TTS-STREAM', `Segment "${seg.type}" [${String(segIdx)}] → ${String(validParts.length)} chunk(s), queue size: ${String(this.chunkQueue.length)}`);
        this.ensurePumpsRunning();
    }

    /** Signal end of segments and wait for all generation/playback to finish. */
    async flushStream(): Promise<void> {
        if (!this.streamActive) {
            throw new TTSError('flushStream() called but TTS pipeline is not initialized (no active stream)');
        }

        this.streamComplete = true;
        this.ensurePumpsRunning();

        // Wait for both pumps to finish
        if (this.generationPromise) await this.generationPromise;
        if (this.playbackPromise) await this.playbackPromise;

        // Surface any accumulated pipeline error
        if (this.pipelineError) {
            const err = this.pipelineError;
            this.pipelineError = null;
            throw err;
        }

        this.debugLog('TTS-STREAM', 'Stream finished');
    }

    // ─── Pump Management ──────────────────────────────────────────────────

    private ensurePumpsRunning(): void {
        if (!this.generationRunning) {
            this.generationPromise = this.runGenerationPump();
        }
        if (!this.playbackRunning) {
            this.playbackPromise = this.runPlaybackPump();
        }
    }

    private async runGenerationPump(): Promise<void> {
        if (this.generationRunning) return;
        this.generationRunning = true;

        try {
            while (!this.streamAborted) {
                const chunk = this.chunkQueue.shift();
                if (chunk) {
                    const startTime = Date.now();
                    try {
                        let result: GeneratedWav | null;

                        if (this.audioEnabled && this.openai && this.tempDir) {
                            result = await this.generateWithOpenAI(chunk);
                        } else {
                            // Silent typewriter mode: compute duration from text length
                            const audioDuration = chunk.text.length / DEFAULT_CHARS_PER_SEC;
                            result = { filePath: '', index: chunk.index, charBudget: chunk.charBudget, audioDuration, segmentIndex: chunk.segmentIndex };
                        }

                        // streamAborted may have been set during generation
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if (this.streamAborted) break;

                        if (result) {
                            this.wavQueue.push(result);
                            const elapsed = Date.now() - startTime;
                            this.debugLog('TTS-STREAM', `Generated chunk ${String(chunk.index)} in ${String(elapsed)}ms (${result.audioDuration.toFixed(1)}s audio): "${chunk.text.slice(0, 60)}..."`);
                        } else {
                            // Generation returned null (aborted) — stop
                            break;
                        }
                    } catch (err: unknown) {
                        // API error — set pipeline error, drain queue, and stop
                        const detail = err instanceof Error ? err.message : String(err);
                        this.pipelineError = new TTSError(`TTS generation failed for chunk ${String(chunk.index)}: ${detail}`);
                        this.chunkQueue = [];
                        break;
                    }
                    continue;
                }

                // No chunks available — check if we're done
                if (this.streamComplete) break;

                // Poll for new chunks
                await new Promise<void>((r) => setTimeout(r, 50));
            }
        } finally {
            this.generationRunning = false;
        }
    }

    private async runPlaybackPump(): Promise<void> {
        if (this.playbackRunning) return;
        this.playbackRunning = true;

        try {
            while (!this.streamAborted) {
                // Find the next WAV in index order
                const wavIdx = this.wavQueue.findIndex(w => w.index === this.nextPlayIndex);
                if (wavIdx !== -1) {
                    const wav = this.wavQueue.splice(wavIdx, 1)[0];
                    try {
                        // Signal UI to reveal this chunk's text in sync with audio/pause
                        if (wav.charBudget && this.onRevealChunk) {
                            this.onRevealChunk(wav.segmentIndex, wav.charBudget, wav.audioDuration);
                        }

                        if (wav.filePath) {
                            // Audio mode: play the WAV file
                            this.debugLog('TTS-STREAM', `Playing chunk ${String(wav.index)}`);
                            await this.playWav(wav.filePath);
                            await unlink(wav.filePath).catch(() => { /* ignore */ });
                        } else {
                            // Silent typewriter mode: pause for the computed duration
                            this.debugLog('TTS-STREAM', `Silent pause for chunk ${String(wav.index)} (${wav.audioDuration.toFixed(1)}s)`);
                            await this.silentPause(wav.audioDuration);
                        }
                    } catch (err: unknown) {
                        this.pipelineError = err instanceof TTSError ? err : new TTSError(`Playback failed: ${String(err)}`);
                        if (wav.filePath) {
                            await unlink(wav.filePath).catch(() => { /* ignore */ });
                        }
                        break;
                    }
                    this.nextPlayIndex++;
                    continue;
                }

                // No WAV ready — check if generation is done and nothing left, or if a pipeline error occurred
                if (this.pipelineError) break;
                if (!this.generationRunning && this.wavQueue.length === 0 && this.chunkQueue.length === 0 && this.streamComplete) {
                    break;
                }

                // Poll for new WAVs
                await new Promise<void>((r) => setTimeout(r, 30));
            }
        } finally {
            this.playbackRunning = false;
        }
    }

    // ─── Playback ─────────────────────────────────────────────────────────

    /** Wait for a duration (used for silent typewriter pacing). Cancellable via stop(). */
    private silentPause(durationSec: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.silentPauseResolve = resolve;
            this.silentPauseTimer = setTimeout(() => {
                this.silentPauseTimer = null;
                this.silentPauseResolve = null;
                resolve();
            }, durationSec * 1000);
        });
    }

    private async playWav(filePath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                const proc = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath], {
                    stdio: 'ignore',
                });
                this.currentProcess = proc;

                proc.on('close', () => {
                    this.currentProcess = null;
                    resolve();
                });

                proc.on('error', (err: Error) => {
                    this.currentProcess = null;
                    reject(new TTSError(`Playback error: ${err.message}`));
                });
            } catch (err: unknown) {
                this.currentProcess = null;
                reject(new TTSError(`Playback spawn error: ${String(err)}`));
            }
        });
    }

    // ─── Control ──────────────────────────────────────────────────────────

    stop(): void {
        this.streamAborted = true;
        this.streamComplete = true;
        this.streamActive = false;
        this.pipelineError = null;

        // Cancel any silent pause timer and resolve its pending promise
        if (this.silentPauseTimer) {
            clearTimeout(this.silentPauseTimer);
            this.silentPauseTimer = null;
        }
        if (this.silentPauseResolve) {
            this.silentPauseResolve();
            this.silentPauseResolve = null;
        }

        // Kill current playback
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
            } catch { /* ignore */ }
            this.currentProcess = null;
        }

        // Abort any in-flight API requests
        if (this.abortController) {
            try {
                this.abortController.abort();
            } catch { /* ignore */ }
            this.abortController = null;
        }

        // Drain queues and clean up pending WAV files
        this.chunkQueue = [];
        const pendingWavs = this.wavQueue.splice(0);
        for (const wav of pendingWavs) {
            if (wav.filePath) {
                unlink(wav.filePath).catch(() => { /* ignore */ });
            }
        }
    }

    hasApiKey(): boolean {
        return this.openai !== null;
    }

    isAudioEnabled(): boolean {
        return this.audioEnabled;
    }

    setAudioEnabled(value: boolean): void {
        // Can't enable audio without an API key
        if (value && !this.openai) return;
        this.audioEnabled = value;
    }

    /** Set the OpenAI API key at runtime, enabling audio TTS. */
    async setApiKey(key: string): Promise<void> {
        process.env['OPENAI_API_KEY'] = key;
        this.openai = new OpenAI();

        try {
            await this.checkFfplay();
        } catch {
            this.openai = null;
            this.audioEnabled = false;
            throw new TTSError('ffplay not found. Install ffmpeg to enable TTS audio playback.');
        }

        this.audioEnabled = true;
        this.debugLog('TTS', 'API key set — audio TTS enabled');
        await this.persistApiKey(key);
    }

    /** Write the API key to .env.local so Bun auto-loads it on next launch. */
    private async persistApiKey(key: string): Promise<void> {
        const envPath = join(process.cwd(), '.env.local');
        try {
            let content = '';
            try {
                content = await readFile(envPath, 'utf-8');
            } catch {
                // File doesn't exist yet — start fresh
            }

            const line = `OPENAI_API_KEY=${key}`;
            if (/^OPENAI_API_KEY=.*/m.test(content)) {
                content = content.replace(/^OPENAI_API_KEY=.*/m, () => line);
            } else {
                content = content.length > 0 && !content.endsWith('\n')
                    ? `${content}\n${line}\n`
                    : `${content}${line}\n`;
            }

            await writeFile(envPath, content, { mode: 0o600 });
            this.debugLog('TTS', 'API key persisted to .env.local');
        } catch (err: unknown) {
            // Persistence failure should never break the game
            this.debugLog('TTS', `Failed to persist API key: ${String(err)}`);
        }
    }

    async cleanup(): Promise<void> {
        this.stop();
        // Wait for pumps to finish after abort
        if (this.generationPromise) await this.generationPromise;
        if (this.playbackPromise) await this.playbackPromise;
        // Release the OpenAI client
        this.openai = null;
        if (this.tempDir) {
            await rm(this.tempDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
            this.tempDir = null;
        }
    }
}
