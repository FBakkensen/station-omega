import type { DisplaySegment } from '../../engine/types';

export function makeSegment(
  overrides: Pick<DisplaySegment, 'segmentIndex' | 'text'> & Partial<DisplaySegment>,
): DisplaySegment {
  const type = overrides.type ?? 'narration';
  return {
    type,
    text: overrides.text,
    npcId: overrides.npcId ?? null,
    crewName: overrides.crewName ?? null,
    speakerName: overrides.speakerName !== undefined ? overrides.speakerName : (type === 'narration' ? 'Vector' : null),
    segmentIndex: overrides.segmentIndex,
  };
}
