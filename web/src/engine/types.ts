/**
 * Shared types for the web engine layer.
 * These mirror src/schema.ts GameSegment + DisplaySegment but without Zod dependency.
 */

export type SegmentType = 'narration' | 'dialogue' | 'thought' | 'station_pa' | 'crew_echo' | 'diagnostic_readout';

export interface GameSegment {
  type: SegmentType;
  text: string;
  npcId: string | null;
  crewName: string | null;
}

export interface DisplaySegment extends GameSegment {
  speakerName: string | null;
  segmentIndex: number;
  missionTime?: string;
}

/** A styled text span for React rendering (replaces @opentui TextChunk). */
export interface StyledSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  color?: string;
}

/** Choice from the suggest_actions tool. */
export interface Choice {
  id: string;
  label: string;
  description: string;
}
