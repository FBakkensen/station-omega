import type { GeneratedStation } from './types.js';

/**
 * Return the AI-generated video prompt for a station's briefing video.
 * Returns undefined only for legacy stations that predate the identity layer.
 */
export function buildBriefingVideoPrompt(station: GeneratedStation): string | undefined {
  return station.briefingVideoPrompt;
}
