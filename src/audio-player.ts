// ─── In-process audio playback via PvSpeaker (@picovoice/pvspeaker-node) ────
//
// PvSpeaker has an internal circular buffer and accepts any size PCM write —
// no manual frame splitting or padding required.
//
// Wraps PvSpeaker with graceful fallback — if the native module fails to load,
// TTS degrades to silent typewriter mode without crashing.

import type { PvSpeaker as PvSpeakerType } from '@picovoice/pvspeaker-node';

let speaker: PvSpeakerType | null = null;

export async function initAudioPlayer(sampleRate: number): Promise<boolean> {
    try {
        const { PvSpeaker } = await import('@picovoice/pvspeaker-node');
        speaker = new PvSpeaker(sampleRate, 16, { bufferSizeSecs: 60 });
        return true;
    } catch {
        return false;  // Silent typewriter mode
    }
}

export function isPlayerAvailable(): boolean {
    return speaker !== null;
}

export function startPlayer(): void {
    if (!speaker) return;
    try { speaker.start(); } catch { /* already started — safe to ignore */ }
}

export function writePlayer(pcmBuffer: Buffer): void {
    if (!speaker || pcmBuffer.length === 0) return;
    // PvSpeaker expects ArrayBuffer — copy to a fresh one to handle subarray views
    const arrayBuffer = new ArrayBuffer(pcmBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(pcmBuffer);
    speaker.write(arrayBuffer);
}

export function stopPlayer(): void {
    if (!speaker) return;
    try { speaker.stop(); } catch { /* already stopped — safe to ignore */ }
}

export function releasePlayer(): void {
    if (!speaker) return;
    try { speaker.stop(); } catch { /* safe to ignore */ }
    try { speaker.release(); } catch { /* safe to ignore */ }
    speaker = null;
}
