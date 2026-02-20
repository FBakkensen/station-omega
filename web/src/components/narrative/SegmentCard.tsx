import type { StyledSpan } from '../../engine/types';
import { segmentCardStyle } from '../../engine/segmentStyles';
import type { SegmentType } from '../../engine/types';
import { truncateSpans } from '../../engine/markdownToSpans';

interface SegmentCardProps {
  type: SegmentType;
  spans: StyledSpan[];
  revealedChars: number;
  finalized: boolean;
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

export function SegmentCard({ type, spans, revealedChars, finalized }: SegmentCardProps) {
  const cardStyle = segmentCardStyle(type);
  const visibleSpans = finalized ? spans : truncateSpans(spans, revealedChars);

  return (
    <div
      className="p-3 text-sm leading-relaxed"
      style={{
        backgroundColor: cardStyle.bg,
        borderLeft: `3px solid ${cardStyle.border}`,
      }}
    >
      {visibleSpans.map((span, i) => (
        <StyledSpanEl key={i} span={span} />
      ))}
      {!finalized && (
        <span className="animate-pulse text-omega-dim">▊</span>
      )}
    </div>
  );
}
