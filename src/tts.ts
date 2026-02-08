import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import type { KokoroTTS } from 'kokoro-js';
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

type VoiceId = keyof KokoroTTS['voices'];

interface SpeechChunk {
    text: string;
    displayText: string;
    voice: VoiceId;
    index: number;
}

interface GeneratedWav {
    filePath: string;
    index: number;
    displayText: string;
    audioDuration: number;
}

// ─── Voice Pool ────────────────────────────────────────────────────────────

const NARRATOR_VOICE: VoiceId = 'bm_george';

const NPC_VOICE_POOL: VoiceId[] = [
    'af_heart', 'af_bella', 'af_nicole', 'af_kore', 'af_alloy',
    'af_aoede', 'af_sky', 'am_adam', 'am_michael', 'bm_lewis', 'af_jessica',
];

const BOSS_VOICE: VoiceId = 'bm_lewis';

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
    private currentVoice: VoiceId;
    private getVoiceForNPC: (npcId: string) => VoiceId;

    constructor(defaultVoice: VoiceId, getVoiceForNPC: (npcId: string) => VoiceId) {
        this.currentVoice = defaultVoice;
        this.getVoiceForNPC = getVoiceForNPC;
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

            const voice = seg.type === 'npc_dialogue' && seg.npcId
                ? this.getVoiceForNPC(seg.npcId)
                : this.currentVoice;

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
                chunks.push({ text: part, displayText: partDisplay, voice, index: nextIndex.value++ });
            }
        }

        return chunks;
    }
}

// ─── Worker Response Types ────────────────────────────────────────────────

interface WorkerReadyMsg {
    type: 'ready';
    voices: string[];
}

interface WorkerGeneratedMsg {
    type: 'generated';
    filePath: string;
    index: number;
    streamId: number;
    displayText: string;
    audioDuration: number;
    elapsed: number;
}

interface WorkerErrorMsg {
    type: 'error';
    index: number;
    streamId: number;
    displayText: string;
    error: string;
}

type WorkerResponse = WorkerReadyMsg | WorkerGeneratedMsg | WorkerErrorMsg;

// ─── TTS Engine ────────────────────────────────────────────────────────────

interface TTSEngineOptions {
    enabled?: boolean;
    debugLog?: (label: string, content: string) => void;
}

export class TTSEngine {
    private worker: Worker | null = null;
    private streamId = 0;
    private pendingGenerate = new Map<string, (result: GeneratedWav | null) => void>();
    private enabled: boolean;
    private debugLog: (label: string, content: string) => void;
    private npcTierMap = new Map<string, number>();
    private tempDir: string | null = null;
    private currentProcess: ChildProcess | null = null;
    private availableVoices = new Set<VoiceId>();

    // ─── Error accumulation ────────────────────────────────────────────────
    private pipelineError: TTSError | null = null;
    private lastWorkerError: string | null = null;

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
        this.enabled = options.enabled ?? true;
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
        // Create temp directory for WAV files
        this.tempDir = await mkdtemp(join(tmpdir(), 'station-omega-tts-'));

        // Spawn worker thread for ONNX inference (keeps main thread free for UI)
        const workerPath = new URL('./tts-worker.ts', import.meta.url);
        this.worker = new Worker(workerPath);

        // Wait for the worker to load the model and report available voices
        const voices = await new Promise<string[]>((resolve, reject) => {
            const onMsg = (msg: WorkerResponse) => {
                if (msg.type === 'ready') {
                    this.worker?.off('message', onMsg);
                    resolve(msg.voices);
                } else if (msg.type === 'error' && msg.index === -1) {
                    this.worker?.off('message', onMsg);
                    reject(new TTSError(`TTS worker init failed: ${msg.error}`));
                }
            };
            this.worker?.on('message', onMsg);
            this.worker?.postMessage({ type: 'init' });
        });

        for (const v of voices) {
            this.availableVoices.add(v as VoiceId);
        }

        // Validate required voices are available
        const voiceList = () => [...this.availableVoices].join(', ');
        if (!this.availableVoices.has(NARRATOR_VOICE)) {
            throw new TTSError(`Required narrator voice "${NARRATOR_VOICE}" not available. Available: ${voiceList()}`);
        }
        if (!this.availableVoices.has(BOSS_VOICE)) {
            throw new TTSError(`Required boss voice "${BOSS_VOICE}" not available. Available: ${voiceList()}`);
        }

        // Handle Worker-level errors (crash, unhandled exception in worker)
        let workerDead = false;
        this.worker.on('error', (err: Error) => {
            this.debugLog('TTS-WORKER', `Worker error: ${err.message}`);
            if (!workerDead) {
                workerDead = true;
                this.lastWorkerError = err.message;
                this.pipelineError = new TTSError(`TTS worker crashed: ${err.message}`);
                // Resolve all pending generation promises so pumps unblock
                for (const [, resolve] of this.pendingGenerate) {
                    resolve(null);
                }
                this.pendingGenerate.clear();
            }
        });
        this.worker.on('exit', (code: number) => {
            this.debugLog('TTS-WORKER', `Worker exited with code ${String(code)}`);
            if (code !== 0 && !workerDead) {
                workerDead = true;
                this.lastWorkerError = `Worker exited with code ${String(code)}`;
                this.pipelineError = new TTSError(`TTS worker exited unexpectedly (code ${String(code)})`);
                // Resolve all pending generation promises so pumps unblock
                for (const [, resolve] of this.pendingGenerate) {
                    resolve(null);
                }
                this.pendingGenerate.clear();
            }
            this.worker = null;
        });

        // Permanent message handler for generation responses
        this.worker.on('message', (msg: WorkerResponse) => {
            this.onWorkerMessage(msg);
        });

        // Verify ffplay is available for audio playback
        await this.checkFfplay();

        this.debugLog('TTS', `Initialized worker. ${String(voices.length)} voices available. Temp dir: ${this.tempDir}`);
    }

    private onWorkerMessage(msg: WorkerResponse): void {
        if (msg.type === 'generated') {
            const key = `${String(msg.streamId)}:${String(msg.index)}`;
            const resolve = this.pendingGenerate.get(key);
            if (resolve) {
                this.pendingGenerate.delete(key);
                resolve({
                    filePath: msg.filePath, index: msg.index,
                    displayText: msg.displayText, audioDuration: msg.audioDuration,
                });
            } else {
                // Stale response from a previous stream — clean up the WAV file
                unlink(msg.filePath).catch(() => { /* ignore */ });
            }
        } else if (msg.type === 'error' && msg.index !== -1) {
            const key = `${String(msg.streamId)}:${String(msg.index)}`;
            const resolve = this.pendingGenerate.get(key);
            if (resolve) {
                this.pendingGenerate.delete(key);
                this.debugLog('TTS-STREAM', `Worker error for chunk ${String(msg.index)}: ${msg.error}`);
                resolve(null);
            }
        }
    }

    /** Send a chunk to the worker and return a promise that resolves with the generated WAV. */
    private generateInWorker(chunk: SpeechChunk): Promise<GeneratedWav | null> {
        return new Promise<GeneratedWav | null>((resolve) => {
            const key = `${String(this.streamId)}:${String(chunk.index)}`;
            this.pendingGenerate.set(key, resolve);
            this.worker?.postMessage({
                type: 'generate',
                text: chunk.text,
                voice: chunk.voice,
                index: chunk.index,
                streamId: this.streamId,
                displayText: chunk.displayText,
                tempDir: this.tempDir,
            });
        });
    }

    setNPCs(npcs: Map<string, NPC>): void {
        this.npcTierMap.clear();
        for (const [id, npc] of npcs) {
            this.npcTierMap.set(id, npc.tier);
        }
    }

    private getVoiceForNPC(npcId: string): VoiceId {
        // Tier-4 bosses always use the boss voice
        const tier = this.npcTierMap.get(npcId);
        if (tier === 4) return this.resolveVoice(BOSS_VOICE);

        // Deterministic hash into the NPC voice pool
        const idx = hashString(npcId) % NPC_VOICE_POOL.length;
        return this.resolveVoice(NPC_VOICE_POOL[idx]);
    }

    private resolveVoice(voice: VoiceId): VoiceId {
        if (this.availableVoices.has(voice)) return voice;
        throw new TTSError(`Voice "${voice}" not available. Available: ${[...this.availableVoices].join(', ')}`);
    }

    // ─── Streaming API ────────────────────────────────────────────────────

    /** Reset state and prepare for a new streaming response. */
    beginStream(): void {
        if (!this.enabled) return;
        if (!this.worker || !this.tempDir) {
            throw new TTSError('beginStream() called but TTS engine is not initialized (worker or tempDir missing)');
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
            (npcId) => this.getVoiceForNPC(npcId),
        );

        this.debugLog('TTS-STREAM', 'Stream started');
    }

    /** Feed a streaming delta into the pipeline. */
    pushDelta(delta: string): void {
        if (!this.enabled || this.streamAborted) return;
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
        if (!this.enabled) return;
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
                    const result = await this.generateInWorker(chunk);

                    // streamAborted may have been set during generation
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (this.streamAborted) break;

                    if (result) {
                        this.wavQueue.push(result);
                        const elapsed = Date.now() - startTime;
                        this.debugLog('TTS-STREAM', `Generated chunk ${String(chunk.index)} in ${String(elapsed)}ms (${result.audioDuration.toFixed(1)}s audio): "${chunk.text.slice(0, 60)}..."`);
                    } else {
                        // Generation failed — set pipeline error, drain queue, and stop
                        const detail = this.lastWorkerError ?? 'unknown worker error';
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
                        // Signal UI to reveal this chunk's text in sync with audio
                        if (wav.displayText && this.onRevealChunk) {
                            this.onRevealChunk(wav.displayText, wav.audioDuration);
                        }
                        this.debugLog('TTS-STREAM', `Playing chunk ${String(wav.index)}`);
                        await this.playWav(wav.filePath);
                    } catch (err: unknown) {
                        this.pipelineError = err instanceof TTSError ? err : new TTSError(`Playback failed: ${String(err)}`);
                        await unlink(wav.filePath).catch(() => { /* ignore */ });
                        break;
                    } finally {
                        await unlink(wav.filePath).catch(() => { /* ignore */ });
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

        // Kill current playback
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
            } catch { /* ignore */ }
            this.currentProcess = null;
        }

        // Resolve pending worker requests so the generation pump can exit
        for (const [, resolve] of this.pendingGenerate) {
            resolve(null);
        }
        this.pendingGenerate.clear();

        // Drain queues and clean up pending WAV files
        this.chunkQueue = [];
        const pendingWavs = this.wavQueue.splice(0);
        for (const wav of pendingWavs) {
            unlink(wav.filePath).catch(() => { /* ignore */ });
        }

        // Reset parser
        if (this.parser) {
            this.parser.reset();
            this.parser = null;
        }
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async cleanup(): Promise<void> {
        this.stop();
        // Wait for pumps to finish after abort
        if (this.generationPromise) await this.generationPromise;
        if (this.playbackPromise) await this.playbackPromise;
        // Terminate the worker thread
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        if (this.tempDir) {
            await rm(this.tempDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
            this.tempDir = null;
        }
    }
}
