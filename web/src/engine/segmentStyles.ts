import type { DisplaySegment, StyledSpan } from './types';
import { markdownToSpans } from './markdownToSpans';
import { SEGMENT_COLORS, HEADER_COLORS, CARD_STYLES } from '../styles/theme';

/** Human-readable labels for image categories (used in image strip + lightbox). */
export const IMAGE_CATEGORY_LABELS: Record<string, string> = {
  room_scene: 'CAM FEED',
  npc_portrait: 'BIO SCAN',
  item_image: 'SPEC ANALYSIS',
  briefing: 'BRIEFING',
  briefing_video: 'BRIEFING',
};

/** Card visual config for a segment type. */
export interface CardStyle {
  bg: string;
  border: string;
}

/** Get card background + border colors for a segment type. */
export function segmentCardStyle(type: DisplaySegment['type']): CardStyle {
  return CARD_STYLES[type];
}

/** Build header spans for a segment (speaker name, tags, etc.). */
function buildHeaderSpans(seg: DisplaySegment): StyledSpan[] {
  switch (seg.type) {
    case 'narration': {
      const name = seg.speakerName ?? 'Narrator';
      return [
        { text: '[OPERATOR] ', bold: true, color: HEADER_COLORS.narration },
        { text: name, bold: true, color: '#e6f2ff' },
        { text: '\n', color: '#5a6a7a' },
      ];
    }
    case 'dialogue': {
      const name = seg.speakerName ?? 'Unknown';
      return [
        { text: name, bold: true, color: HEADER_COLORS.dialogue },
        { text: '\n', color: '#5a6a7a' },
      ];
    }
    case 'thought': {
      const timeLabel = seg.missionTime ? `\u00AB ${seg.missionTime} \u00BB` : '\u00AB Thinking... \u00BB';
      return [
        { text: timeLabel, italic: true, color: HEADER_COLORS.thought },
        { text: '\n', color: '#5a6a7a' },
      ];
    }
    case 'station_pa':
      return [
        { text: '[STATION PA]', bold: true, color: HEADER_COLORS.station_pa },
        { text: '\n', color: '#5a6a7a' },
      ];
    case 'crew_echo': {
      const name = seg.speakerName ?? seg.crewName ?? 'Unknown';
      return [
        { text: '[CREW LOG] ', bold: true, color: HEADER_COLORS.crew_echo },
        { text: name, bold: true, color: '#f0e6ff' },
        { text: '\n', color: '#5a6a7a' },
      ];
    }
    case 'diagnostic_readout':
      return [
        { text: '[TERMINAL] ', bold: true, color: HEADER_COLORS.diagnostic_readout },
        { text: 'DIAGNOSTIC READOUT', bold: true, color: '#d8fff4' },
        { text: '\n', color: '#5a6a7a' },
      ];
    case 'player_action':
      return [
        { text: '> ', bold: true, color: HEADER_COLORS.player_action },
      ];
  }
}

/**
 * Convert a DisplaySegment to pre-styled StyledSpan[].
 *
 * Parses inline markdown ONCE, then maps each run to a StyledSpan with the
 * segment's base color and format attributes. Header spans are prepended.
 */
export function segmentToStyledSpans(seg: DisplaySegment): { spans: StyledSpan[]; headerCharCount: number } {
  const headerSpans = buildHeaderSpans(seg);
  const headerCharCount = countSpanChars(headerSpans);
  const baseColor = SEGMENT_COLORS[seg.type];
  const { spans: bodySpans } = markdownToSpans(seg.text, baseColor);
  return { spans: [...headerSpans, ...bodySpans], headerCharCount };
}

/** Count total visible characters in a StyledSpan array. */
export function countSpanChars(spans: StyledSpan[]): number {
  let total = 0;
  for (const span of spans) {
    total += span.text.length;
  }
  return total;
}

/** Count visible characters in header spans for a segment. */
export function getHeaderCharCount(seg: DisplaySegment): number {
  return countSpanChars(buildHeaderSpans(seg));
}
