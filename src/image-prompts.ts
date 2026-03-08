import type { Room, GeneratedStation, ActiveEvent, RoomArchetype, SystemFailure } from './types.js';

export const STYLE_SUFFIX = 'Retro 1970s sci-fi concept art, muted color palette, analog instrumentation, moody atmospheric lighting, worn industrial surfaces, film grain texture. No text or labels.';

const ARCHETYPE_SCALE: Record<RoomArchetype, string> = {
  reactor: 'vast industrial',
  cargo: 'cavernous',
  command: 'expansive',
  science: 'wide open',
  medical: 'long sterile',
  utility: 'sprawling mechanical',
  restricted: 'deep fortified',
  entry: 'broad docking',
  escape: 'towering launch',
  quarters: 'narrow crew',
};

function archetypeScale(archetype: RoomArchetype): string {
  return ARCHETYPE_SCALE[archetype];
}

function exitPhrase(connectionCount: number): string {
  switch (connectionCount) {
    case 1: return 'A single bulkhead door leads out.';
    case 2: return 'Two corridor hatches on opposite walls.';
    case 3: return 'Three corridors branch off from this compartment.';
    default: return `${String(connectionCount)} passageways connect to adjacent sections.`;
  }
}

function severityDamagePhrase(f: SystemFailure): string {
  const system = f.systemId.replace(/_/g, ' ');
  switch (f.severity) {
    case 1: return `Minor ${f.failureMode} wear on the ${system}`;
    case 2: return `Severe ${f.failureMode} damage to the ${system}, panels buckled and warning indicators lit`;
    case 3: return `Catastrophic ${f.failureMode} failure in the ${system}, ruptured conduits and sparking wreckage`;
  }
}

/** Truncate at the last `.` within maxLen. Returns empty string if no sentence boundary found — incomplete fragments are worse than nothing for image prompts. */
function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > 0) {
    return truncated.slice(0, lastPeriod + 1);
  }
  return '';
}

export function buildRoomImagePrompt(
  room: Room,
  station: GeneratedStation,
  activeEvents: ActiveEvent[],
): string {
  const parts: string[] = [];

  // 1. Subject + scale (~15w) — front-loaded for T5 attention window
  parts.push(`Interior view of a ${archetypeScale(room.archetype)} ${room.archetype} compartment aboard a space station.`);

  // 2. Exit architecture (~8w)
  if (room.connections.length > 0) {
    parts.push(exitPhrase(room.connections.length));
  }

  // 3. Damage — worst severity only (~15w)
  const activeFailures = room.systemFailures
    .filter(f => f.status !== 'nominal' && f.status !== 'repaired')
    .sort((a, b) => b.severity - a.severity);
  if (activeFailures.length > 0) {
    parts.push(`Visible damage: ${severityDamagePhrase(activeFailures[0])}.`);
  }

  // 4. Active event (~10w, first sentence only)
  const roomEvents = activeEvents.filter(e =>
    e.type === 'hull_breach' || e.type === 'power_failure' || e.type === 'radiation_spike' ||
    e.type === 'atmosphere_alarm' || e.type === 'coolant_leak' || e.type === 'structural_alert',
  );
  if (roomEvents.length > 0) {
    const eventText = truncateAtSentence(roomEvents[0].description, 80);
    if (eventText) parts.push(eventText);
  }

  // 5. Sensory visual — first entry, first sentence only (~15w)
  if (room.sensory.visuals.length > 0) {
    const visual = truncateAtSentence(room.sensory.visuals[0], 100);
    if (visual) parts.push(visual);
  }

  // 6. Visual style seed — first sentence only, capped (~15w)
  if (station.visualStyleSeed) {
    const style = truncateAtSentence(station.visualStyleSeed, 80);
    if (style) parts.push(style);
  }

  // 7. Style suffix (~25w)
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

export function buildItemImagePrompt(
  item: { name: string; description: string; category: string },
  visualStyleSeed?: string,
): string {
  const parts: string[] = [];

  if (visualStyleSeed) {
    parts.push(`${visualStyleSeed}.`);
  }

  parts.push(`Close-up view of a ${item.category} item: ${item.name}.`);

  const desc = truncateAtSentence(item.description, 120);
  if (desc) parts.push(desc);

  parts.push('Resting on a worn metal surface inside a space station.');
  parts.push(STYLE_SUFFIX);

  return parts.join(' ');
}
