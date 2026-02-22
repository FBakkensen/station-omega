import { useRef, useCallback, useEffect } from 'react';
import type { DisplaySegment } from '../engine/types';
import { extractCleanText } from '../engine/markdownToSpans';
import { requestTTSAudio } from '../services/tts-client';

// ─── Voice Pool (Inworld voice IDs) ─────────────────────────────────────

const NARRATOR_VOICE = 'Ronald';
const INNER_VOICE = 'Alex';
const STATION_PA_VOICE = 'Elizabeth';

const NPC_VOICE_POOL: string[] = [
  'Ashley', 'Craig', 'Deborah', 'Dennis',
  'Edward', 'Julia', 'Mark', 'Olivia', 'Priya',
  'Sarah', 'Luna', 'Theodore', 'Hades',
  'Wendy', 'Hana', 'Clive', 'Carter', 'Blake',
  'Timothy', 'Shaun',
];

// ─── Voice Tuning ────────────────────────────────────────────────────────

interface VoiceTuning {
  temperature: number;
  speakingRate: number;
}

const TUNING_DEFAULT: VoiceTuning = { temperature: 1.2, speakingRate: 1.0 };
const TUNING_INNER: VoiceTuning = { temperature: 1.3, speakingRate: 1.05 };
const TUNING_PA: VoiceTuning = { temperature: 0.5, speakingRate: 1.0 };
const TUNING_CREW_ECHO: VoiceTuning = { temperature: 1.0, speakingRate: 1.0 };
const TUNING_DIAGNOSTIC: VoiceTuning = { temperature: 0.4, speakingRate: 1.1 };

// ─── Helpers ─────────────────────────────────────────────────────────────

function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function stripMarkdown(text: string): string {
  return extractCleanText(text)
    .replace(/\u2800/g, '')
    .replace(/[*_~`]/g, '')
    .trim();
}

const NUMERIC_EMPHASIS_RE = /\b(\d+(?:\.\d+)?)\s*(degrees?|percent|minutes?|hours?|seconds?|RPM|meters?|kilometers?)\b/g;

function addEmphasisMarkers(text: string): string {
  return text.replace(NUMERIC_EMPHASIS_RE, '*$1 $2*');
}

function splitLongText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = -1;
    for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
      const idx = remaining.lastIndexOf(sep, maxLen);
      if (idx > splitAt) splitAt = idx + sep.length;
    }
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

const SENTENCE_END_RE = /[.!?](?:\s|$)/;

function getEmotionMarkup(segType: string, npcDisposition?: string, hpPercent = 100): string {
  switch (segType) {
    case 'narration':
      return hpPercent < 25 ? '[sigh] ' : '[laughing] ';
    case 'dialogue':
      return npcDisposition === 'fearful' ? '[whispering] ' : '';
    case 'thought':
    case 'crew_echo':
      return '[sigh] ';
    default:
      return '';
  }
}

function getVoiceConfig(seg: DisplaySegment): { voiceId: string; tuning: VoiceTuning } {
  switch (seg.type) {
    case 'dialogue':
      if (seg.npcId) {
        const idx = hashString(seg.npcId) % NPC_VOICE_POOL.length;
        return { voiceId: NPC_VOICE_POOL[idx], tuning: TUNING_DEFAULT };
      }
      return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
    case 'thought':
      return { voiceId: INNER_VOICE, tuning: TUNING_INNER };
    case 'station_pa':
      return { voiceId: STATION_PA_VOICE, tuning: TUNING_PA };
    case 'crew_echo':
      if (seg.crewName) {
        const idx = hashString(`crew_${seg.crewName}`) % NPC_VOICE_POOL.length;
        return { voiceId: NPC_VOICE_POOL[idx], tuning: TUNING_CREW_ECHO };
      }
      return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
    case 'diagnostic_readout':
      return { voiceId: STATION_PA_VOICE, tuning: TUNING_DIAGNOSTIC };
    default:
      return { voiceId: NARRATOR_VOICE, tuning: TUNING_DEFAULT };
  }
}

// ─── Speech chunk types ─────────────────────────────────────────────────

interface SpeechChunk {
  text: string;
  charBudget: number;
  voiceId: string;
  temperature: number;
  speakingRate: number;
  index: number;
  segmentIndex: number;
}

interface GeneratedAudio {
  buffer: ArrayBuffer;
  index: number;
  charBudget: number;
  audioDuration: number;
  segmentIndex: number;
}

// ─── Hook ────────────────────────────────────────────────────────────────

export interface UseTTSResult {
  pushSegment: (seg: DisplaySegment, bodyChars: number) => void;
  beginStream: () => void;
  flushStream: () => void;
  stop: () => void;
}

/**
 * Web Audio TTS hook.
 * Generates speech via Convex TTS proxy, plays via AudioContext.
 * Calls onRevealChunk to sync typewriter with audio timing.
 * Calls onStreamComplete when all queued audio finishes playing.
 */
export function useTTS(
  ttsProxyUrl: string | null,
  enabled: boolean,
  onRevealChunk: (segmentIndex: number, charBudget: number, durationSec: number) => void,
  onStreamComplete?: () => void,
): UseTTSResult {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chunkQueueRef = useRef<SpeechChunk[]>([]);
  const audioQueueRef = useRef<GeneratedAudio[]>([]);
  const nextChunkIndexRef = useRef(0);
  const nextPlayIndexRef = useRef(0);
  const streamActiveRef = useRef(false);
  const streamCompleteRef = useRef(false);
  const genRunningRef = useRef(false);
  const playRunningRef = useRef(false);
  const epochRef = useRef(0);
  const onRevealChunkRef = useRef(onRevealChunk);
  const onStreamCompleteRef = useRef(onStreamComplete);

  // Keep callback refs up to date
  onRevealChunkRef.current = onRevealChunk;
  onStreamCompleteRef.current = onStreamComplete;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Lazy AudioContext init (needs user gesture)
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // ─── TTS API call ───────────────────────────────────────────────────

  const generateSpeech = useCallback(async (chunk: SpeechChunk): Promise<GeneratedAudio | null> => {
    if (!ttsProxyUrl) return null;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const wavBuffer = await requestTTSAudio(
        ttsProxyUrl,
        {
          text: chunk.text,
          voiceId: chunk.voiceId,
          temperature: chunk.temperature,
          speakingRate: chunk.speakingRate,
        },
        controller.signal,
      );
      if (!wavBuffer) return null;

      // Parse WAV duration from header (byte rate at offset 28)
      const view = new DataView(wavBuffer);
      const byteRate = view.getUint32(28, true);
      const audioDuration = (wavBuffer.byteLength - 44) / byteRate;

      abortRef.current = null;
      return {
        buffer: wavBuffer,
        index: chunk.index,
        charBudget: chunk.charBudget,
        audioDuration,
        segmentIndex: chunk.segmentIndex,
      };
    } catch {
      abortRef.current = null;
      return null;
    }
  }, [ttsProxyUrl]);

  // ─── Generation pump ───────────────────────────────────────────────

  const isStreamActive = useCallback(() => streamActiveRef.current, []);

  const runGenerationPump = useCallback(async () => {
    if (genRunningRef.current) return;
    genRunningRef.current = true;
    const epoch = epochRef.current;

    try {
      while (isStreamActive() && epochRef.current === epoch) {
        const chunk = chunkQueueRef.current.shift();
        if (chunk) {
          const result = await generateSpeech(chunk);
          if (!isStreamActive() || epochRef.current !== epoch) break;
          if (result) {
            audioQueueRef.current.push(result);
          } else {
            // Push a silent fallback so the playback pump doesn't stall
            // ~150 WPM ≈ 12.5 chars/sec, min 0.5s
            const fallbackDuration = Math.max(chunk.text.length / 12.5, 0.5);
            audioQueueRef.current.push({
              buffer: new ArrayBuffer(0),
              index: chunk.index,
              charBudget: chunk.charBudget,
              audioDuration: fallbackDuration,
              segmentIndex: chunk.segmentIndex,
            });
          }
          continue;
        }
        if (streamCompleteRef.current) break;
        await new Promise<void>((r) => { setTimeout(r, 50); });
      }
    } finally {
      // Only clear running flag if this pump is still the current epoch
      if (epochRef.current === epoch) {
        genRunningRef.current = false;
      }
    }
  }, [generateSpeech, isStreamActive]);

  // ─── Playback pump ─────────────────────────────────────────────────

  const runPlaybackPump = useCallback(async () => {
    if (playRunningRef.current) return;
    playRunningRef.current = true;
    const epoch = epochRef.current;

    try {
      while (isStreamActive() && epochRef.current === epoch) {
        const audioIdx = audioQueueRef.current.findIndex(
          (a) => a.index === nextPlayIndexRef.current,
        );
        if (audioIdx !== -1) {
          const audio = audioQueueRef.current.splice(audioIdx, 1)[0];

          // Signal typewriter to reveal text
          onRevealChunkRef.current(audio.segmentIndex, audio.charBudget, audio.audioDuration);

          // Skip decode for silent fallback chunks (from failed TTS)
          if (audio.buffer.byteLength > 0) {
            // Decode and play via Web Audio API
            const ctx = getAudioContext();
            try {
              const audioBuffer = await ctx.decodeAudioData(audio.buffer.slice(0));
              if (epochRef.current !== epoch) break;
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.start();

              // Wait for playback to complete
              await new Promise<void>((resolve) => {
                source.onended = () => { resolve(); };
                // Fallback timeout in case onended doesn't fire
                setTimeout(resolve, audio.audioDuration * 1000 + 200);
              });
            } catch {
              // Decode error — skip this chunk, just wait the duration
              await new Promise<void>((r) => { setTimeout(r, audio.audioDuration * 1000); });
            }
          } else {
            // Silent fallback — wait the computed duration so typewriter can reveal
            await new Promise<void>((r) => { setTimeout(r, audio.audioDuration * 1000); });
          }

          nextPlayIndexRef.current++;
          continue;
        }

        // No audio ready
        if (
          !genRunningRef.current &&
          audioQueueRef.current.length === 0 &&
          chunkQueueRef.current.length === 0 &&
          streamCompleteRef.current
        ) {
          break;
        }

        await new Promise<void>((r) => { setTimeout(r, 30); });
      }

      // Stream fully played — notify caller
      if (streamCompleteRef.current && epochRef.current === epoch) {
        onStreamCompleteRef.current?.();
      }
    } finally {
      // Only clear running flag if this pump is still the current epoch
      if (epochRef.current === epoch) {
        playRunningRef.current = false;
      }
    }
  }, [getAudioContext, isStreamActive]);

  // ─── Ensure pumps running ──────────────────────────────────────────

  const ensurePumpsRunning = useCallback(() => {
    if (!genRunningRef.current) void runGenerationPump();
    if (!playRunningRef.current) void runPlaybackPump();
  }, [runGenerationPump, runPlaybackPump]);

  // ─── Public API ────────────────────────────────────────────────────

  const beginStream = useCallback(() => {
    // Increment epoch so stale pumps from the previous turn detect the mismatch and exit
    epochRef.current++;

    // Abort any in-flight TTS fetch from the previous turn
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Force-reset running flags so new pumps can start even if old ones haven't exited yet
    genRunningRef.current = false;
    playRunningRef.current = false;

    chunkQueueRef.current = [];
    audioQueueRef.current = [];
    nextChunkIndexRef.current = 0;
    nextPlayIndexRef.current = 0;
    streamActiveRef.current = true;
    streamCompleteRef.current = false;
  }, []);

  const pushSegment = useCallback((seg: DisplaySegment, bodyChars: number) => {
    if (!streamActiveRef.current || !enabledRef.current) return;

    const segIdx = seg.segmentIndex;
    let clean = stripMarkdown(seg.text);
    if (!clean) return;

    if (seg.type === 'thought' || seg.type === 'narration' || seg.type === 'crew_echo') {
      clean = addEmphasisMarkers(clean);
    }

    const { voiceId, tuning } = getVoiceConfig(seg);
    const emotionMarkup = getEmotionMarkup(seg.type);

    const parts = splitLongText(clean, 500);
    const validParts = parts.filter(p => p.trim() && (SENTENCE_END_RE.test(p) || p.length >= 20));

    let budgetUsed = 0;
    for (let i = 0; i < validParts.length; i++) {
      const part = validParts[i];
      const isLast = i === validParts.length - 1;
      const ratio = part.length / Math.max(clean.length, 1);
      const chunkBudget = isLast
        ? bodyChars - budgetUsed
        : Math.round(bodyChars * ratio);
      budgetUsed += chunkBudget;

      chunkQueueRef.current.push({
        text: emotionMarkup + part,
        charBudget: chunkBudget,
        voiceId,
        temperature: tuning.temperature,
        speakingRate: tuning.speakingRate,
        index: nextChunkIndexRef.current++,
        segmentIndex: segIdx,
      });
    }

    ensurePumpsRunning();
  }, [ensurePumpsRunning]);

  const flushStream = useCallback(() => {
    streamCompleteRef.current = true;
    ensurePumpsRunning();
  }, [ensurePumpsRunning]);

  const stop = useCallback(() => {
    streamActiveRef.current = false;
    streamCompleteRef.current = true;
    chunkQueueRef.current = [];
    audioQueueRef.current = [];

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamActiveRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
      }
    };
  }, []);

  return {
    pushSegment,
    beginStream,
    flushStream,
    stop,
  };
}
