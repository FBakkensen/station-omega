import { useEffect, useRef } from 'react';
import type { DisplaySegment, Choice } from '../../engine/types';
import { SegmentCard } from './SegmentCard';
import { ChoiceCard } from './ChoiceCard';
import type { TypewriterCard } from '../../hooks/useTypewriter';

interface NarrativePanelProps {
  segments: DisplaySegment[];
  typewriterCards: Map<number, TypewriterCard>;
  choices: Choice[] | null;
  onChoice: (choiceId: string) => void;
  isStreaming: boolean;
}

export function NarrativePanel({
  segments,
  typewriterCards,
  choices,
  onChoice,
  isStreaming,
}: NarrativePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Track whether user has scrolled away from bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 80; // px from bottom
      isNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener('scroll', handleScroll);
    return () => { el.removeEventListener('scroll', handleScroll); };
  }, []);

  // Auto-scroll only when near bottom and new content arrives
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments.length, isStreaming]);

  if (segments.length === 0 && !isStreaming) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <p className="text-omega-dim text-sm text-center py-8">
          Awaiting first transmission...
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
      {segments.map((seg) => {
        const card = typewriterCards.get(seg.segmentIndex);
        if (!card) return null;
        return (
          <SegmentCard
            key={seg.segmentIndex}
            type={seg.type}
            spans={card.spans}
            revealedChars={card.revealedChars}
            finalized={card.finalized}
          />
        );
      })}

      {isStreaming && (
        <div className="flex items-center gap-2 px-3 py-2 text-omega-dim text-xs">
          <span className="animate-pulse">...</span>
          <span>Processing transmission</span>
        </div>
      )}

      {choices && choices.length > 0 && !isStreaming && (
        <ChoiceCard choices={choices} onChoice={onChoice} />
      )}
    </div>
  );
}
