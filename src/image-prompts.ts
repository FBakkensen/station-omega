import type { Room, GeneratedStation, ActiveEvent } from './types.js';

const STYLE_SUFFIX = 'Retro 1970s sci-fi concept art, muted color palette, analog instrumentation, moody atmospheric lighting, worn industrial surfaces, film grain texture. No text or labels.';

function stylePrefix(station: GeneratedStation): string {
  return station.visualStyleSeed ? `${station.visualStyleSeed}. ` : '';
}

/**
 * Extract visual descriptions from narrative segments for image prompt enrichment.
 * Filters to descriptive segment types and truncates at a sentence boundary.
 */
export function extractNarrativeVisuals(
  segments: Array<{ type: string; text: string }>,
  maxLength = 200,
): string {
  const visualTypes = new Set(['narration', 'crew_echo']);
  const text = segments
    .filter(s => visualTypes.has(s.type))
    .map(s => s.text)
    .join(' ');

  if (!text) return '';

  if (text.length <= maxLength) return text;

  // Truncate at last sentence boundary within maxLength
  const truncated = text.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > 0) {
    return truncated.slice(0, lastPeriod + 1);
  }
  return truncated;
}

export function buildRoomImagePrompt(
  room: Room,
  station: GeneratedStation,
  activeEvents: ActiveEvent[],
  narrativeContext?: string,
): string {
  const parts: string[] = [];

  parts.push(`${stylePrefix(station)}Interior view of ${room.name}, a ${room.archetype} compartment on space station "${station.stationName}".`);

  // Add 2-3 visual sensory details
  if (room.sensory.visuals.length > 0) {
    const visuals = room.sensory.visuals.slice(0, 3).join('. ');
    parts.push(visuals + '.');
  }

  // Add system failure damage cues
  const activeFailures = room.systemFailures.filter(
    f => f.status !== 'nominal' && f.status !== 'repaired',
  );
  if (activeFailures.length > 0) {
    const failureDesc = activeFailures
      .slice(0, 2)
      .map(f => `${f.failureMode} damage to ${f.systemId.replace(/_/g, ' ')}`)
      .join(', ');
    parts.push(`Visible damage: ${failureDesc}.`);
  }

  // Add active event modifiers
  const roomEvents = activeEvents.filter(e =>
    e.type === 'hull_breach' || e.type === 'power_failure' || e.type === 'radiation_spike',
  );
  if (roomEvents.length > 0) {
    const eventDescs = roomEvents.map(e => e.description).slice(0, 1);
    parts.push(eventDescs.join('. ') + '.');
  }

  if (narrativeContext) {
    parts.push(`Scene context: ${narrativeContext}`);
  }

  parts.push(STYLE_SUFFIX);
  return parts.join(' ');
}

export function buildNPCImagePrompt(
  npc: { name: string; appearance: string; disposition: string },
  room: { name: string; archetype: string },
  visualStyleSeed?: string,
): string {
  const parts: string[] = [];

  if (visualStyleSeed) {
    parts.push(`${visualStyleSeed}.`);
  }

  parts.push(`Portrait of ${npc.name}, ${npc.appearance}.`);

  const expressionMap: Record<string, string> = {
    neutral: 'calm, guarded expression',
    friendly: 'warm, relieved expression',
    fearful: 'nervous, wary expression',
  };
  const expression = expressionMap[npc.disposition] ?? 'neutral expression';
  parts.push(`${expression}.`);

  parts.push(`Inside ${room.name}, a ${room.archetype} compartment on a space station.`);
  parts.push(STYLE_SUFFIX);

  return parts.join(' ');
}

export function buildBriefingImagePrompt(
  station: GeneratedStation,
): string {
  const parts: string[] = [];

  if (station.visualStyleSeed) {
    parts.push(`${station.visualStyleSeed}.`);
  }

  parts.push(`Exterior view of space station "${station.stationName}" in deep space.`);
  parts.push(`${station.briefing.split('.').slice(0, 2).join('.')}.`);
  parts.push('Dramatic lighting from a nearby star, visible damage and debris.');
  parts.push(STYLE_SUFFIX);

  return parts.join(' ');
}
