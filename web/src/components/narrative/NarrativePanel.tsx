import { useEffect, useRef, useMemo } from 'react';
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
  allFinalized: boolean;
}

export function NarrativePanel({
  segments,
  typewriterCards,
  choices,
  onChoice,
  isStreaming,
  allFinalized,
}: NarrativePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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

  // Auto-scroll via ResizeObserver — fires when content height changes
  // (new card appears or text grows during typewriter reveal)
  useEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;

    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scroll.scrollTop = scroll.scrollHeight;
      }
    });

    observer.observe(content);
    return () => { observer.disconnect(); };
  }, []);

  // Compute visible indices: all finalized cards + the first non-finalized card
  const visibleIndices = useMemo(() => {
    const visible = new Set<number>();
    let foundRevealing = false;
    for (const seg of segments) {
      const card = typewriterCards.get(seg.segmentIndex);
      if (!card) continue;
      if (card.finalized) {
        visible.add(seg.segmentIndex);
      } else if (!foundRevealing) {
        // First non-finalized card — show it (currently revealing)
        visible.add(seg.segmentIndex);
        foundRevealing = true;
      }
      // Remaining non-finalized cards are hidden (queued)
    }
    return visible;
  }, [segments, typewriterCards]);

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
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
      <div ref={contentRef} className="space-y-2">
        {segments.map((seg) => {
          const card = typewriterCards.get(seg.segmentIndex);
          if (!card) return null;
          if (!visibleIndices.has(seg.segmentIndex)) return null;
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

        {choices && choices.length > 0 && !isStreaming && allFinalized && (
          <ChoiceCard choices={choices} onChoice={onChoice} />
        )}
      </div>
    </div>
  );
}
