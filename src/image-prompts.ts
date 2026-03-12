import type { Room, GeneratedStation, ActiveEvent, RoomArchetype, SystemFailure } from './types.js';

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

export const CINEMATIC_SUFFIX = 'Dramatic directional lighting with deep shadows. Dark atmospheric haze. Cinematic wide-angle, shallow depth of field.';

export function buildRoomImagePrompt(
  room: Room,
  station: GeneratedStation,
  activeEvents: ActiveEvent[],
): string {
  const parts: string[] = [];

  // 1. Subject + scale (~15w) — front-loaded for T5 attention window, dark framing
  parts.push(`Dark interior of a ${archetypeScale(room.archetype)} ${room.archetype} compartment aboard a damaged space station.`);

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

  // 6. Station visual style guide
  if (station.visualStyleGuide) {
    parts.push(station.visualStyleGuide);
  }

  // 7. Cinematic anchor — ensures dark/dramatic consistency across all room images
  parts.push('Widescreen 16:9 landscape composition.');
  parts.push(CINEMATIC_SUFFIX);

  return parts.join(' ');
}


// ─── NPC Image: Void Portrait ────────────────────────────────────────────────

const DISPOSITION_LIGHTING: Record<string, string> = {
  neutral: 'Amber side-light, balanced chiaroscuro with half-face in deep shadow',
  friendly: 'Warm golden front-fill, softer shadows revealing open expression',
  fearful: 'Harsh red under-lighting, deep angular shadows obscuring half the face',
};

const DISPOSITION_PARTICLES: Record<string, string> = {
  neutral: 'Fine particles drifting through the light.',
  friendly: 'Soft haze catching the warmth of the light.',
  fearful: 'Faint embers and scattered pinpoints of light.',
};

const DISPOSITION_BODY: Record<string, string> = {
  neutral: 'guarded stance, arms at sides',
  friendly: 'relaxed posture, slight lean forward',
  fearful: 'tense shoulders, eyes darting',
};

const DISPOSITION_EXPRESSION: Record<string, string> = {
  neutral: 'calm, watchful gaze',
  friendly: 'warm, relieved expression',
  fearful: 'nervous, wide-eyed stare',
};

const DEFAULT_NPC_LIGHTING = 'Cool white side-light, stark shadows';
const DEFAULT_NPC_PARTICLES = 'Fine particles drifting through the light.';
const DEFAULT_NPC_BODY = 'neutral stance';
const DEFAULT_NPC_EXPRESSION = 'neutral expression';

export function buildNPCImagePrompt(
  npc: { name: string; appearance: string; disposition: string },
): string {
  const parts: string[] = [];

  const expression = DISPOSITION_EXPRESSION[npc.disposition] ?? DEFAULT_NPC_EXPRESSION;
  const body = DISPOSITION_BODY[npc.disposition] ?? DEFAULT_NPC_BODY;
  parts.push(`Dramatic close-up portrait of ${npc.name}, ${npc.appearance}.`);
  parts.push(`${expression}, ${body}.`);

  const lighting = DISPOSITION_LIGHTING[npc.disposition] ?? DEFAULT_NPC_LIGHTING;
  parts.push(`${lighting}.`);

  const particles = DISPOSITION_PARTICLES[npc.disposition] ?? DEFAULT_NPC_PARTICLES;
  parts.push(particles);

  parts.push('Dark background dissolving to black.');

  parts.push('Widescreen 16:9 cinematic portrait, Caravaggio lighting, shallow depth of field, 85mm lens.');

  return parts.join(' ');
}

export function buildBriefingImagePrompt(
  station: GeneratedStation,
): string {
  const parts: string[] = [];

  parts.push(`Dark silhouette of space station "${station.stationName}" against deep space.`);
  parts.push(`${station.briefing.split('.').slice(0, 2).join('.')}.`);
  parts.push('Harsh directional star-light raking across damaged hull, deep shadows and visible debris.');

  if (station.visualStyleGuide) {
    parts.push(station.visualStyleGuide);
  }

  parts.push('Cinematic wide shot, film grain, shallow depth of field.');

  return parts.join(' ');
}

// ─── Item Image: Void-Isolated Hero Prop ─────────────────────────────────────

const CATEGORY_LIGHT_COLOR: Record<string, string> = {
  medical: 'Deep crimson directional light, sharp rim light defining edges',
  tool: 'Warm amber directional light, hard rim light on worn metal',
  material: 'Cool blue-white directional light, crisp rim light on raw surfaces',
  component: 'Orange-amber directional light, warm rim light tracing circuitry',
  chemical: 'Toxic green directional light, sickly rim light on sealed surfaces',
  key: 'White-gold directional light cutting through haze, bright rim light',
};

const CATEGORY_GLOW: Record<string, string> = {
  medical: 'faint bio-monitor glow and indicator LEDs',
  tool: 'dull power indicator and heat-stressed edges',
  component: 'faint circuit traces and status LEDs',
  chemical: 'subtle chemical luminescence from within',
  key: 'faint energy signature pulsing from the core',
};

const DEFAULT_ITEM_LIGHT = 'Cool white directional light, strong rim light defining edges';

export function buildItemImagePrompt(
  item: { name: string; description: string; category: string },
): string {
  const parts: string[] = [];

  // Subject-first for T5 attention
  parts.push(`${item.name}, weathered and battle-scarred.`);

  const desc = truncateAtSentence(item.description, 100);
  if (desc) parts.push(desc);

  const glow = CATEGORY_GLOW[item.category];
  if (glow) parts.push(`${glow}.`);

  const light = CATEGORY_LIGHT_COLOR[item.category] ?? DEFAULT_ITEM_LIGHT;
  parts.push(`${light}. Dark void background.`);

  parts.push('Extreme close-up, widescreen 16:9 composition, shallow depth of field, macro lens.');

  parts.push('No text, labels, or UI elements.');

  return parts.join(' ');
}
