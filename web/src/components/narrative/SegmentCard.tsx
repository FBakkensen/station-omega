import type { StyledSpan, EntityRef } from '../../engine/types';
import { segmentCardStyle } from '../../engine/segmentStyles';
import type { SegmentType } from '../../engine/types';
import { truncateSpans } from '../../engine/markdownToSpans';
import type { StationImage } from '../../hooks/useStationImages';
import { SegmentImageStrip } from './SegmentImageStrip';

interface SegmentCardProps {
  type: SegmentType;
  spans: StyledSpan[];
  revealedChars: number;
  finalized: boolean;
  entityRefs?: EntityRef[] | null;
  stationImages?: Map<string, StationImage>;
}

/** Render a single StyledSpan as a <span> with inline styles. */
function StyledSpanEl({ span }: { span: StyledSpan }) {
  const style: React.CSSProperties = {};
  if (span.color) style.color = span.color;
  if (span.bold) style.fontWeight = 'bold';
  if (span.italic) style.fontStyle = 'italic';
  if (span.strikethrough) style.textDecoration = 'line-through';
  if (span.code) {
    style.fontFamily = 'inherit';
    style.padding = '0 0.2em';
    style.borderRadius = '2px';
    style.backgroundColor = 'rgba(255, 136, 68, 0.1)';
  }

  // Preserve newlines
  const parts = span.text.split('\n');
  return (
    <span style={style}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
}

function SegmentText({ spans, finalized }: { spans: StyledSpan[]; finalized: boolean }) {
  return (
    <>
      {spans.map((span, i) => (
        <StyledSpanEl key={i} span={span} />
      ))}
      {!finalized && (
        <span className="animate-pulse text-omega-dim">▊</span>
      )}
    </>
  );
}

export function SegmentCard({ type, spans, revealedChars, finalized, entityRefs, stationImages }: SegmentCardProps) {
  const cardStyle = segmentCardStyle(type);
  const visibleSpans = finalized ? spans : truncateSpans(spans, revealedChars);

  // Resolve entity refs to image URLs
  const images: StationImage[] = [];
  if (entityRefs && stationImages) {
    for (const ref of entityRefs) {
      const cacheKey = `${ref.type}:${ref.id}`;
      const img = stationImages.get(cacheKey);
      if (img) images.push(img);
    }
  }
  const hasImages = images.length > 0;

  return (
    <div
      className="p-3 text-sm leading-relaxed"
      style={{
        backgroundColor: cardStyle.bg,
        borderLeft: `3px solid ${cardStyle.border}`,
      }}
    >
      <SegmentText spans={visibleSpans} finalized={finalized} />
      {hasImages && (
        <SegmentImageStrip
          images={images}
          finalized={finalized}
          cardBorderColor={cardStyle.border}
          cardBgColor={cardStyle.bg}
        />
      )}
    </div>
  );
}
