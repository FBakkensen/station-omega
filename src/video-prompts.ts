import type { GeneratedStation } from './types.js';

/**
 * Return the Veo 3.1-optimized video prompt for a station's briefing video.
 *
 * Prefers the AI-generated `briefingVideoPrompt` from the creative identity layer,
 * which is written by the same AI that knows the station's narrative and can translate
 * it into proper cinematic direction (camera, visuals, audio cues).
 *
 * Falls back to a generic prompt for older stations that lack the field.
 */
export function buildBriefingVideoPrompt(station: GeneratedStation): string {
  if (station.briefingVideoPrompt) {
    return station.briefingVideoPrompt;
  }

  // Fallback for stations generated before briefingVideoPrompt was added
  const style = station.visualStyleSeed
    ? `${station.visualStyleSeed}. `
    : '';

  return [
    `A slow dolly forward through deep space toward a massive derelict space station named ${station.stationName}.`,
    `${style}Damaged hull plating and debris drifting in the void.`,
    'Dim emergency lighting pulses through cracked viewport glass. The station rotates slowly.',
    'Distant metallic groaning, intermittent radio static, and a faint low-frequency hum.',
    'Retro 1970s sci-fi aesthetic, muted color palette, heavy film grain, moody atmospheric lighting.',
  ].join(' ');
}
