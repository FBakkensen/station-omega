import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
    hpPercent: number;
    isNewRoom: boolean;
}

interface SpeechChunk {
    text: string;
    charBudget: number;
    voiceId: string;
    temperature: number;
    speakingRate: number;
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

// ─── Inworld API ───────────────────────────────────────────────────────────

const INWORLD_API_BASE = 'https://api.inworld.ai/tts/v1';
const INWORLD_MODEL = 'inworld-tts-1.5-max';
const INWORLD_SAMPLE_RATE = 48000;
const INWORLD_BITS_PER_SAMPLE = 16;
const INWORLD_CHANNELS = 1;

// ─── Voice Pool (Inworld voice IDs) ───────────────────────────────────────

const NARRATOR_VOICE = 'Ronald';

const NPC_VOICE_POOL: string[] = [
    'Ashley', 'Craig', 'Deborah', 'Dennis',
    'Edward', 'Julia', 'Mark', 'Olivia', 'Priya',
    'Sarah', 'Luna', 'Theodore', 'Hades',
    'Wendy', 'Hana', 'Clive', 'Carter', 'Blake',
    'Timothy', 'Shaun',
];

const INNER_VOICE = 'Alex';

const STATION_PA_VOICE = 'Elizabeth';

// ─── Voice Tuning (temperature / speaking rate per role) ─────────────────

interface VoiceTuning {
    temperature: number;
    speakingRate: number;
}

const TUNING_DEFAULT: VoiceTuning = { temperature: 1.2, speakingRate: 1.0 };
const TUNING_INNER: VoiceTuning = { temperature: 1.3, speakingRate: 1.05 };
const TUNING_PA: VoiceTuning = { temperature: 0.5, speakingRate: 1.0 };
const TUNING_CREW_ECHO: VoiceTuning = { temperature: 1.0, speakingRate: 1.0 };
const TUNING_DIAGNOSTIC: VoiceTuning = { temperature: 0.4, speakingRate: 1.1 };

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

/** Patterns that match numbers with units or technical measurements for TTS emphasis. */
const NUMERIC_EMPHASIS_RE = /\b(\d+(?:\.\d+)?)\s*(degrees?|percent|minutes?|hours?|seconds?|RPM|meters?|kilometers?)\b/g;

/** Wrap numbers-with-units in *emphasis* markers for Inworld TTS prosody steering. */
function addEmphasisMarkers(text: string): string {
    return text.replace(NUMERIC_EMPHASIS_RE, '*$1 $2*');
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

/** Build a complete WAV file from raw PCM data. */
function createWavBuffer(rawAudio: Buffer, channels: number, sampleRate: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = rawAudio.byteLength;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);                           // ChunkID
    header.writeUInt32LE(36 + dataSize, 4);            // ChunkSize
    header.write('WAVE', 8);                           // Format
    header.write('fmt ', 12);                          // Subchunk1ID
    header.writeUInt32LE(16, 16);                      // Subchunk1Size (PCM)
    header.writeUInt16LE(1, 20);                       // AudioFormat (PCM = 1)
    header.writeUInt16LE(channels, 22);                // NumChannels
    header.writeUInt32LE(sampleRate, 24);               // SampleRate
    header.writeUInt32LE(byteRate, 28);                // ByteRate
    header.writeUInt16LE(blockAlign, 32);              // BlockAlign
    header.writeUInt16LE(bitsPerSample, 34);           // BitsPerSample
    header.write('data', 36);                          // Subchunk2ID
    header.writeUInt32LE(dataSize, 40);                // Subchunk2Size

    return Buffer.concat([header, rawAudio]);
}

/** Sentence-end boundary: punctuation followed by whitespace or end-of-string. */
const SENTENCE_END_RE = /[.!?](?:\s|$)/;

// ─── TTS Engine ────────────────────────────────────────────────────────────

const DEFAULT_CHARS_PER_SEC = 18;

interface TTSEngineOptions {
    debugLog?: (label: string, content: string) => void;
}

export class TTSEngine {
    private inworldApiKey: string | null = null;
    private streamId = 0;
    private audioEnabled = false;
    private debugLog: (label: string, content: string) => void;
    private npcMap = new Map<string, NPC>();
    private crewRoster: CrewMember[] = [];
    private narratorContext: NarratorContext = { hpPercent: 100, isNewRoom: false };
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
        if (!process.env['INWORLD_API_KEY']) {
            this.debugLog('TTS', 'No INWORLD_API_KEY — running in silent typewriter mode');
            return;
        }

        try {
            this.inworldApiKey = process.env['INWORLD_API_KEY'];
            await this.checkFfplay();
            this.audioEnabled = true;

            // Check persisted voice preference
            if (process.env['VOICE_ENABLED'] === 'false') {
                this.audioEnabled = false;
                this.debugLog('TTS', 'Voice disabled by VOICE_ENABLED=false setting');
            }

            this.debugLog('TTS', `Initialized Inworld TTS client (${INWORLD_MODEL}). Temp dir: ${this.tempDir}`);
        } catch (err: unknown) {
            this.inworldApiKey = null;
            this.audioEnabled = false;
            this.debugLog('TTS', `Audio unavailable (${String(err)}) — running in silent typewriter mode`);
        }
    }

    /** Generate speech via Inworld TTS streaming API and save to a WAV file. */
    private async generateWithInworld(chunk: SpeechChunk): Promise<GeneratedWav | null> {
        if (!this.inworldApiKey || !this.tempDir) return null;

        try {
            this.abortController = new AbortController();
            const response = await fetch(`${INWORLD_API_BASE}/voice:stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${this.inworldApiKey}`,
                },
                body: JSON.stringify({
                    text: chunk.text,
                    voice_id: chunk.voiceId,
                    model_id: INWORLD_MODEL,
                    audio_config: {
                        audio_encoding: 'LINEAR16',
                        sample_rate_hertz: INWORLD_SAMPLE_RATE,
                        speaking_rate: chunk.speakingRate,
                    },
                    temperature: chunk.temperature,
                }),
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                let errorDetails = '';
                try { errorDetails = await response.text(); } catch { /* ignore */ }
                throw new TTSError(`Inworld TTS HTTP ${String(response.status)}: ${errorDetails}`);
            }

            // Parse streaming NDJSON response — each line has { result: { audioContent: "base64..." } }
            const reader = response.body?.getReader();
            if (!reader) throw new TTSError('Inworld TTS response has no body');

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
                            const audioChunk = Buffer.from(parsed.result.audioContent, 'base64');
                            // Strip WAV header from individual chunks (first 44 bytes if present)
                            const isRiff = audioChunk.subarray(0, 4).toString() === 'RIFF';
                            if (isRiff && audioChunk.length > 44) {
                                rawChunks.push(audioChunk.subarray(44));
                            } else if (!isRiff) {
                                rawChunks.push(audioChunk);
                            }
                            // Discard RIFF chunks with no audio payload (≤ 44 bytes)
                        }
                    } catch {
                        // Skip malformed JSON lines
                    }
                }
            }

            // Process any remaining buffer content (final line without trailing newline)
            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer) as { result?: { audioContent?: string } };
                    if (parsed.result?.audioContent) {
                        const audioChunk = Buffer.from(parsed.result.audioContent, 'base64');
                        if (audioChunk.length > 44 && audioChunk.subarray(0, 4).toString() === 'RIFF') {
                            rawChunks.push(audioChunk.subarray(44));
                        } else {
                            rawChunks.push(audioChunk);
                        }
                    }
                } catch {
                    // Skip malformed JSON
                }
            }

            const combinedAudio = Buffer.concat(rawChunks);
            // Build a single WAV file with proper header
            const wavBuffer = createWavBuffer(combinedAudio, INWORLD_CHANNELS, INWORLD_SAMPLE_RATE, INWORLD_BITS_PER_SAMPLE);
            const filePath = join(this.tempDir, `tts-${String(this.streamId)}-${String(chunk.index)}.wav`);
            await writeFile(filePath, wavBuffer);

            const audioDuration = parseWavDuration(wavBuffer);

            this.abortController = null;
            return { filePath, index: chunk.index, charBudget: chunk.charBudget, audioDuration, segmentIndex: chunk.segmentIndex };
        } catch (err: unknown) {
            this.abortController = null;
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

    private getVoiceIdForNPC(npcId: string): string {
        // Deterministic hash into the NPC voice pool
        const idx = hashString(npcId) % NPC_VOICE_POOL.length;
        return NPC_VOICE_POOL[idx];
    }

    setCrewRoster(roster: CrewMember[]): void {
        this.crewRoster = roster;
    }

    setNarratorContext(ctx: NarratorContext): void {
        this.narratorContext = ctx;
    }

    /** Get Inworld audio markup prefix for emotional delivery. */
    private getEmotionMarkup(seg: GameSegment): string {
        switch (seg.type) {
            case 'narration': {
                // Dry amusement for observational humor — Andy Weir narrator tone
                if (this.narratorContext.hpPercent < 25) return '[sigh] ';
                return '[laughing] ';
            }
            case 'dialogue': {
                if (seg.npcId) {
                    const npc = this.npcMap.get(seg.npcId);
                    if (npc?.disposition === 'fearful') return '[whispering] ';
                    return '';
                }
                return '';
            }
            case 'thought': {
                // Sardonic inner voice — exasperated calculation
                return '[sigh] ';
            }
            case 'crew_echo': {
                // Tired engineers leaving log entries
                return '[sigh] ';
            }
            case 'station_pa':
                // Clean institutional delivery — no markup
                return '';
            case 'diagnostic_readout':
                // Pure clinical data — no markup
                return '';
            default:
                return '';
        }
    }

    private getCrewEchoVoiceId(crewName: string): string {
        // Deterministic hash into the NPC voice pool (same pool, different base string)
        const idx = hashString(`crew_${crewName}`) % NPC_VOICE_POOL.length;
        return NPC_VOICE_POOL[idx];
    }

    /** Get Inworld voice config (ID + tuning) for a GameSegment. */
    private getVoiceConfigForSegment(seg: GameSegment): { voiceId: string; tuning: VoiceTuning } {
        switch (seg.type) {
            case 'dialogue': {
                if (seg.npcId) {
                    const voiceId = this.getVoiceIdForNPC(seg.npcId);
                    return { voiceId, tuning: TUNING_DEFAULT };
                }
                return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
            }
            case 'thought':
                return { voiceId: INNER_VOICE, tuning: TUNING_INNER };
            case 'station_pa':
                return { voiceId: STATION_PA_VOICE, tuning: TUNING_PA };
            case 'crew_echo': {
                if (seg.crewName) {
                    return { voiceId: this.getCrewEchoVoiceId(seg.crewName), tuning: TUNING_CREW_ECHO };
                }
                return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
            }
            case 'diagnostic_readout':
                return { voiceId: STATION_PA_VOICE, tuning: TUNING_DIAGNOSTIC };
            default:
                return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
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

        let clean = stripMarkdown(seg.text);
        if (!clean) return;

        // Add *emphasis* markers around numbers with units for prosody steering
        // Applied to thought (calculations), narration (atmospheric details), and crew echo (technical reports)
        if (seg.type === 'thought' || seg.type === 'narration' || seg.type === 'crew_echo') {
            clean = addEmphasisMarkers(clean);
        }

        const { voiceId, tuning } = this.getVoiceConfigForSegment(seg);
        const emotionMarkup = this.getEmotionMarkup(seg);

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
            // Prepend emotion markup to every chunk for consistent emotional context
            const textWithMarkup = emotionMarkup + part;
            this.chunkQueue.push({
                text: textWithMarkup,
                charBudget: chunkBudget,
                voiceId,
                temperature: tuning.temperature,
                speakingRate: tuning.speakingRate,
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

                        if (this.audioEnabled && this.inworldApiKey && this.tempDir) {
                            result = await this.generateWithInworld(chunk);
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
        return this.inworldApiKey !== null;
    }

    isAudioEnabled(): boolean {
        return this.audioEnabled;
    }

    setAudioEnabled(value: boolean, persist = false): void {
        // Can't enable audio without an API key
        if (value && !this.inworldApiKey) return;
        this.audioEnabled = value;
        if (persist) {
            void this.persistVoiceEnabled(value);
        }
    }

    /** Set the Inworld API key at runtime, enabling audio TTS. */
    async setApiKey(key: string): Promise<void> {
        process.env['INWORLD_API_KEY'] = key;
        this.inworldApiKey = key;

        try {
            await this.checkFfplay();
        } catch {
            this.inworldApiKey = null;
            this.audioEnabled = false;
            throw new TTSError('ffplay not found. Install ffmpeg to enable TTS audio playback.');
        }

        this.audioEnabled = true;
        this.debugLog('TTS', 'Inworld API key set — audio TTS enabled');
        await this.persistApiKey(key);
        void this.persistVoiceEnabled(true);
    }

    /** Write the Inworld API key to .env.local so Bun auto-loads it on next launch. */
    private async persistApiKey(key: string): Promise<void> {
        const envPath = join(process.cwd(), '.env.local');
        try {
            let content = '';
            try {
                content = await readFile(envPath, 'utf-8');
            } catch {
                // File doesn't exist yet — start fresh
            }

            const line = `INWORLD_API_KEY=${key}`;
            if (/^INWORLD_API_KEY=.*/m.test(content)) {
                content = content.replace(/^INWORLD_API_KEY=.*/m, () => line);
            } else {
                content = content.length > 0 && !content.endsWith('\n')
                    ? `${content}\n${line}\n`
                    : `${content}${line}\n`;
            }

            await writeFile(envPath, content, { mode: 0o600 });
            this.debugLog('TTS', 'Inworld API key persisted to .env.local');
        } catch (err: unknown) {
            // Persistence failure should never break the game
            this.debugLog('TTS', `Failed to persist API key: ${String(err)}`);
        }
    }

    /** Write the voice enabled preference to .env.local so Bun auto-loads it on next launch. */
    private async persistVoiceEnabled(enabled: boolean): Promise<void> {
        const envPath = join(process.cwd(), '.env.local');
        try {
            let content = '';
            try {
                content = await readFile(envPath, 'utf-8');
            } catch {
                // File doesn't exist yet — start fresh
            }

            const line = `VOICE_ENABLED=${String(enabled)}`;
            if (/^VOICE_ENABLED=.*/m.test(content)) {
                content = content.replace(/^VOICE_ENABLED=.*/m, () => line);
            } else {
                content = content.length > 0 && !content.endsWith('\n')
                    ? `${content}\n${line}\n`
                    : `${content}${line}\n`;
            }

            await writeFile(envPath, content, { mode: 0o600 });
            this.debugLog('TTS', `Voice preference persisted to .env.local: ${String(enabled)}`);
        } catch (err: unknown) {
            // Persistence failure should never break the game
            this.debugLog('TTS', `Failed to persist voice preference: ${String(err)}`);
        }
    }

    async cleanup(): Promise<void> {
        this.stop();
        // Wait for pumps to finish after abort
        if (this.generationPromise) await this.generationPromise;
        if (this.playbackPromise) await this.playbackPromise;
        this.inworldApiKey = null;
        if (this.tempDir) {
            await rm(this.tempDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
            this.tempDir = null;
        }
    }
}
