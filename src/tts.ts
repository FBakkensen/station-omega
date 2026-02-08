import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import OpenAI from 'openai';
import type { NPC } from './types.js';
import { extractCleanText } from './markdown-reveal.js';

// ─── Errors ────────────────────────────────────────────────────────────────

export class TTSError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TTSError';
    }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TTSSegment {
    type: 'narration' | 'npc_dialogue';
    text: string;
    npcId?: string;
}

type OpenAIVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable'
    | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

interface VoiceConfig {
    voice: OpenAIVoice;
    instructions: string;
}

interface SpeechChunk {
    text: string;
    displayText: string;
    voice: OpenAIVoice;
    instructions: string;
    index: number;
}

interface GeneratedWav {
    filePath: string;
    index: number;
    displayText: string;
    audioDuration: number;
}

// ─── Voice Pool ────────────────────────────────────────────────────────────

const NARRATOR_VOICE: OpenAIVoice = 'cedar';
const NARRATOR_INSTRUCTIONS = 'You are narrating a sci-fi horror text adventure set on an abandoned space station. Speak with a warm but measured tone, building tension through pacing. Use deliberate pauses before revealing dangers. Keep a steady, grounded delivery — authoritative but not theatrical.';

const NPC_VOICE_POOL: OpenAIVoice[] = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
    'nova', 'sage', 'shimmer', 'verse', 'marin',
];

const BOSS_VOICE: OpenAIVoice = 'onyx';

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

/**
 * Remove [V:id]"..."[/V] markers but keep the quoted dialogue text.
 * Used by the TUI to clean display output.
 */
export function stripVoiceMarkers(text: string): string {
    return text.replace(/\[V:[^\]]*\]"([^"]*?)"\[\/V\]/g, '"$1"');
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

// ─── Segment Parser ────────────────────────────────────────────────────────

const VOICE_MARKER_RE = /\[V:([^\]]+)\]"([^"]*?)"\[\/V\]/g;

/** Parse AI response into ordered narration/dialogue segments. */
export function parseSegments(rawText: string): TTSSegment[] {
    const segments: TTSSegment[] = [];
    let lastIndex = 0;

    for (const match of rawText.matchAll(VOICE_MARKER_RE)) {
        const before = rawText.slice(lastIndex, match.index);
        if (before.trim()) {
            segments.push({ type: 'narration', text: before.trim() });
        }
        segments.push({ type: 'npc_dialogue', text: match[2], npcId: match[1] });
        lastIndex = match.index + match[0].length;
    }

    const after = rawText.slice(lastIndex);
    if (after.trim()) {
        segments.push({ type: 'narration', text: after.trim() });
    }

    return segments;
}

// ─── Incremental Parser ───────────────────────────────────────────────────

/** Sentence-end boundary: punctuation followed by whitespace or end-of-string. */
const SENTENCE_END_RE = /[.!?](?:\s|$)/;

class IncrementalParser {
    private buffer = '';
    private currentVoice: OpenAIVoice;
    private currentInstructions: string;
    private getVoiceConfigForNPC: (npcId: string) => VoiceConfig;

    constructor(defaultVoice: OpenAIVoice, defaultInstructions: string, getVoiceConfigForNPC: (npcId: string) => VoiceConfig) {
        this.currentVoice = defaultVoice;
        this.currentInstructions = defaultInstructions;
        this.getVoiceConfigForNPC = getVoiceConfigForNPC;
    }

    /**
     * Find the safe boundary in the buffer — the position up to which we can
     * safely parse without risking an incomplete `[V:...]"..."[/V]` marker.
     * Returns -1 if no safe boundary exists yet.
     */
    private findSafeBoundary(): number {
        // Check last ~50 chars for an unmatched `[` which could be an incomplete marker
        const tail = this.buffer.slice(-50);
        const lastOpen = tail.lastIndexOf('[');
        if (lastOpen !== -1) {
            // There's a `[` in the tail — check if it's part of a closed marker
            const fromPos = Math.max(0, this.buffer.length - 50) + lastOpen;
            const afterOpen = this.buffer.slice(fromPos);
            // If we find a complete [V:id]"text"[/V] starting here, it's safe
            if (/^\[V:[^\]]*\]"[^"]*"\[\/V\]/.test(afterOpen)) {
                // Marker is complete — safe up to end of buffer
            } else {
                // Incomplete marker — safe boundary is just before the `[`
                return fromPos;
            }
        }
        return this.buffer.length;
    }

    /**
     * Find the last sentence boundary (`.!?` followed by whitespace) within `text`.
     * Returns the index after the punctuation, or -1 if none found.
     */
    private findLastSentenceBoundary(text: string): number {
        let lastPos = -1;
        for (const match of text.matchAll(/[.!?]\s/g)) {
            lastPos = match.index + 1; // include the punctuation
        }
        return lastPos;
    }

    /**
     * Push a streaming delta into the parser. Returns any complete SpeechChunks
     * that can be emitted.
     */
    push(delta: string, nextIndex: { value: number }): SpeechChunk[] {
        this.buffer += delta;

        const safeBoundary = this.findSafeBoundary();
        if (safeBoundary <= 0) return [];

        const safeText = this.buffer.slice(0, safeBoundary);

        // Only emit up to the last sentence boundary within the safe region
        const sentenceEnd = this.findLastSentenceBoundary(safeText);
        if (sentenceEnd <= 0) return [];

        const emitText = this.buffer.slice(0, sentenceEnd);
        this.buffer = this.buffer.slice(sentenceEnd);

        return this.textToChunks(emitText, nextIndex);
    }

    /** Flush remaining buffer content (called when response is complete). */
    flush(nextIndex: { value: number }): SpeechChunk[] {
        if (!this.buffer.trim()) {
            this.buffer = '';
            return [];
        }
        const text = this.buffer;
        this.buffer = '';
        return this.textToChunks(text, nextIndex);
    }

    /** Reset parser state for next response. */
    reset(): void {
        this.buffer = '';
    }

    /** Convert a block of text into SpeechChunks via parseSegments + splitLongText + stripMarkdown. */
    private textToChunks(text: string, nextIndex: { value: number }): SpeechChunk[] {
        const segments = parseSegments(text);
        const chunks: SpeechChunk[] = [];

        for (const seg of segments) {
            const clean = stripMarkdown(seg.text);
            if (!clean) continue;

            // Preserve raw text for UI display (with markdown/voice markers intact)
            const rawDisplay = seg.type === 'npc_dialogue' && seg.npcId
                ? `[V:${seg.npcId}]"${seg.text}"[/V]`
                : seg.text;

            let voice: OpenAIVoice;
            let instructions: string;
            if (seg.type === 'npc_dialogue' && seg.npcId) {
                const config = this.getVoiceConfigForNPC(seg.npcId);
                voice = config.voice;
                instructions = config.instructions;
            } else {
                voice = this.currentVoice;
                instructions = this.currentInstructions;
            }

            const parts = splitLongText(clean, 500);
            // Filter to parts that will actually produce chunks
            const validParts = parts.filter(p => p.trim() && (SENTENCE_END_RE.test(p) || p.length >= 20));
            // Distribute display text proportionally across chunks so each
            // chunk's reveal is paced by its own audio duration.
            let displayOffset = 0;
            for (let i = 0; i < validParts.length; i++) {
                const part = validParts[i];
                const isLast = i === validParts.length - 1;
                const ratio = part.length / Math.max(clean.length, 1);
                const displayLen = isLast
                    ? rawDisplay.length - displayOffset
                    : Math.round(rawDisplay.length * ratio);
                const partDisplay = rawDisplay.slice(displayOffset, displayOffset + displayLen);
                displayOffset += partDisplay.length;
                chunks.push({ text: part, displayText: partDisplay, voice, instructions, index: nextIndex.value++ });
            }
        }

        return chunks;
    }
}

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
    private tempDir: string | null = null;
    private currentProcess: ChildProcess | null = null;
    private abortController: AbortController | null = null;
    private silentPauseTimer: ReturnType<typeof setTimeout> | null = null;
    private silentPauseResolve: (() => void) | null = null;

    // ─── Error accumulation ────────────────────────────────────────────────
    private pipelineError: TTSError | null = null;

    // ─── Streaming pipeline state ─────────────────────────────────────────
    private parser: IncrementalParser | null = null;
    private chunkQueue: SpeechChunk[] = [];
    private wavQueue: GeneratedWav[] = [];
    private nextChunkIndex = { value: 0 };
    private nextPlayIndex = 0;
    private generationRunning = false;
    private playbackRunning = false;
    private streamAborted = false;
    private streamComplete = false;
    private generationPromise: Promise<void> | null = null;
    private playbackPromise: Promise<void> | null = null;

    /** Called when a chunk should be revealed in the UI. Set by the game loop. */
    onRevealChunk: ((displayText: string, durationSec: number) => void) | null = null;

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
            return { filePath, index: chunk.index, displayText: chunk.displayText, audioDuration };
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
        this.nextPlayIndex = 0;
        this.generationPromise = null;
        this.playbackPromise = null;

        this.parser = new IncrementalParser(
            NARRATOR_VOICE,
            NARRATOR_INSTRUCTIONS,
            (npcId) => this.getVoiceConfigForNPC(npcId),
        );

        this.debugLog('TTS-STREAM', 'Stream started');
    }

    /** Feed a streaming delta into the pipeline. */
    pushDelta(delta: string): void {
        if (this.streamAborted) return;
        if (!this.parser) {
            throw new TTSError('pushDelta() called but no active stream (call beginStream() first)');
        }

        const chunks = this.parser.push(delta, this.nextChunkIndex);
        if (chunks.length > 0) {
            this.chunkQueue.push(...chunks);
            this.debugLog('TTS-STREAM', `Parsed ${String(chunks.length)} chunk(s), queue size: ${String(this.chunkQueue.length)}`);
            this.ensurePumpsRunning();
        }
    }

    /** Flush remaining text and wait for all generation/playback to finish. */
    async flushStream(): Promise<void> {
        if (!this.parser) {
            throw new TTSError('flushStream() called but TTS pipeline is not initialized (no active stream)');
        }

        // Flush any remaining text from the parser
        const remaining = this.parser.flush(this.nextChunkIndex);
        if (remaining.length > 0) {
            this.chunkQueue.push(...remaining);
            this.debugLog('TTS-STREAM', `Flushed ${String(remaining.length)} remaining chunk(s)`);
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
                            result = { filePath: '', index: chunk.index, displayText: chunk.displayText, audioDuration };
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
                        if (wav.displayText && this.onRevealChunk) {
                            this.onRevealChunk(wav.displayText, wav.audioDuration);
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

        // Reset parser
        if (this.parser) {
            this.parser.reset();
            this.parser = null;
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
