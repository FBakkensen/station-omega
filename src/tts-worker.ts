/**
 * TTS Worker — runs kokoro-js ONNX inference off the main thread.
 *
 * The main thread's event loop stays free so setInterval-based UI animations
 * (typewriter reveal) tick at a consistent ~33 ms even during generation.
 */

import { parentPort } from 'node:worker_threads';
import { join } from 'node:path';
import type { KokoroTTS } from 'kokoro-js';

// ─── Message types ──────────────────────────────────────────────────────────

interface InitMessage {
    type: 'init';
}

interface GenerateMessage {
    type: 'generate';
    text: string;
    voice: string;
    index: number;
    streamId: number;
    displayText: string;
    tempDir: string;
}

type WorkerInbound = InitMessage | GenerateMessage;

// ─── Worker state ───────────────────────────────────────────────────────────

let tts: KokoroTTS | null = null;

// ─── Message handler ────────────────────────────────────────────────────────

parentPort?.on('message', (msg: WorkerInbound) => {
    void handleMessage(msg);
});

async function handleMessage(msg: WorkerInbound): Promise<void> {
    if (msg.type === 'init') {
        try {
            const mod = await import('kokoro-js') as { KokoroTTS: typeof import('kokoro-js').KokoroTTS };
            tts = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
                dtype: 'q8',
                device: 'cpu',
            });
            const voices = Object.keys(tts.voices);
            parentPort?.postMessage({ type: 'ready', voices });
        } catch (err: unknown) {
            parentPort?.postMessage({ type: 'error', index: -1, displayText: '', error: String(err) });
        }
    } else {
        if (!tts) {
            parentPort?.postMessage({
                type: 'error', index: msg.index, streamId: msg.streamId,
                displayText: msg.displayText, error: 'TTS not initialized',
            });
            return;
        }
        try {
            const startTime = Date.now();
            const audio = await tts.generate(msg.text, { voice: msg.voice as keyof KokoroTTS['voices'] });
            const filePath = join(msg.tempDir, `tts-${String(msg.streamId)}-${String(msg.index)}.wav`);
            await audio.save(filePath);
            const audioDuration = (audio.audio as { length: number }).length / audio.sampling_rate;
            const elapsed = Date.now() - startTime;
            parentPort?.postMessage({
                type: 'generated', filePath, index: msg.index, streamId: msg.streamId,
                displayText: msg.displayText, audioDuration, elapsed,
            });
        } catch (err: unknown) {
            parentPort?.postMessage({
                type: 'error', index: msg.index, streamId: msg.streamId,
                displayText: msg.displayText, error: String(err),
            });
        }
    }
}
