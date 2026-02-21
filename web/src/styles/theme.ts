/**
 * Station Omega color palette used across the web client.
 */

export const COLORS = {
  bg: '#0a0e14',
  panelBg: '#111820',
  border: '#1e3a5f',
  title: '#00e5ff',
  text: '#c0c8d4',
  textDim: '#5a6a7a',
  inputBg: '#0d1117',
  inputFocusBg: '#151d28',
  inputText: '#e0e8f0',
  cursor: '#00e5ff',
  hpGood: '#4dc9f6',
  hpMid: '#f6a623',
  hpLow: '#e84393',
  separator: '#1e3a5f',
  narrative: '#d0d8e0',
  cardBg: '#243348',
  cmdCardBg: '#1e2a3a',
  gradeS: '#ffcc00',
  gradeA: '#00ff88',
  gradeB: '#00e5ff',
  gradeC: '#c0c8d4',
  gradeD: '#ff8844',
  gradeF: '#ff4444',
} as const;

/** Per-segment-type text colors. */
export const SEGMENT_COLORS = {
  narration: '#d0d8e0',
  dialogue: '#e8d8c0',
  thought: '#8abfff',
  station_pa: '#ff8844',
  crew_echo: '#6aad8a',
  diagnostic_readout: '#44ddaa',
  player_action: '#e0e8f0',
} as const;

/** Per-segment-type header colors. */
export const HEADER_COLORS = {
  narration: '#5fb6ff',
  dialogue: '#4a9acc',
  thought: '#b08adf',
  station_pa: '#3a8a3a',
  crew_echo: '#c39bff',
  diagnostic_readout: '#38d6b3',
  player_action: '#00e5ff',
} as const;

/** Per-segment-type card background + border colors. */
export const CARD_STYLES = {
  narration: { bg: '#243348', border: '#3a5068' },
  dialogue: { bg: '#2a3040', border: '#4a7aaa' },
  thought: { bg: '#1e2838', border: '#8a6abf' },
  station_pa: { bg: '#1a2a1a', border: '#3a8a3a' },
  crew_echo: { bg: '#2a2530', border: '#7a5a8a' },
  diagnostic_readout: { bg: '#0a2020', border: '#22aa88' },
  player_action: { bg: '#0d1117', border: '#00e5ff' },
} as const;

/** Grade letter colors for run summary. */
export const GRADE_COLORS: Record<string, string> = {
  S: COLORS.gradeS,
  A: COLORS.gradeA,
  B: COLORS.gradeB,
  C: COLORS.gradeC,
  D: COLORS.gradeD,
  F: COLORS.gradeF,
};

export type SegmentType = keyof typeof SEGMENT_COLORS;
