import type { GameSegment, DisplaySegment } from './types';

/**
 * Station data interface for segment resolution.
 * Mirrors the shape stored in Convex (serialized — Records, not Maps).
 */
interface StationData {
  npcs?: Record<string, { name: string }>;
  crewRoster?: Array<{ name: string; role: string }>;
  arrivalScenario?: { playerCallsign?: string };
}

/**
 * Resolve a raw GameSegment into a DisplaySegment by looking up NPC and crew names.
 * Port of resolveSegment() from index.ts.
 */
export function resolveSegment(
  seg: GameSegment,
  segmentIndex: number,
  stationData: StationData | null,
  missionElapsedMinutes?: number,
): DisplaySegment {
  let speakerName: string | null = null;

  switch (seg.type) {
    case 'narration':
      speakerName = stationData?.arrivalScenario?.playerCallsign ?? null;
      break;
    case 'dialogue':
      if (seg.npcId && stationData?.npcs) {
        const npc: { name: string } | undefined = stationData.npcs[seg.npcId] as { name: string } | undefined;
        speakerName = npc?.name ?? seg.npcId;
      }
      break;
    case 'crew_echo':
      if (seg.crewName && stationData?.crewRoster) {
        const crew = stationData.crewRoster.find(c => c.name === seg.crewName);
        speakerName = crew ? `${crew.name} — ${crew.role}` : seg.crewName;
      }
      break;
    case 'player_action':
      break;
  }

  const display: DisplaySegment = {
    ...seg,
    speakerName,
    segmentIndex,
  };

  if (seg.type === 'thought' && missionElapsedMinutes !== undefined) {
    const hours = Math.floor(missionElapsedMinutes / 60);
    const mins = missionElapsedMinutes % 60;
    display.missionTime = `T+${String(hours).padStart(2, '0')}:${String(Math.floor(mins)).padStart(2, '0')}`;
  }

  return display;
}
