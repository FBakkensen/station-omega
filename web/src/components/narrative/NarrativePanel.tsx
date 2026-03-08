import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import type { DisplaySegment, Choice } from '../../engine/types';
import { SegmentCard } from './SegmentCard';
import { ChoiceCard } from './ChoiceCard';
import type { TypewriterCard } from '../../hooks/useTypewriter';
import type { StationImage } from '../../hooks/useStationImages';

interface NarrativePanelProps {
  segments: DisplaySegment[];
  typewriterCards: Map<number, TypewriterCard>;
  choices: Choice[] | null;
  choiceTitle: string | null;
  onChoice: (choiceId: string) => void;
  isStreaming: boolean;
  allFinalized: boolean;
  stationImages: Map<string, StationImage>;
}

export function NarrativePanel({
  segments,
  typewriterCards,
  choices,
  choiceTitle,
  onChoice,
  isStreaming,
  allFinalized,
  stationImages,
}: NarrativePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // IntersectionObserver on sentinel: visible = user is at bottom, hidden = scrolled up
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroll = scrollRef.current;
    if (!sentinel || !scroll) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollButton(!entry.isIntersecting);
      },
      { root: scroll, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => { observer.disconnect(); };
  }, []);

  const scrollToBottom = useCallback(() => {
    // In column-reverse, scrollTop = 0 is the bottom of content
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="flex flex-col-reverse overflow-y-auto h-full p-4">
        <div className="space-y-2">
          {segments.length === 0 && !isStreaming ? (
            <p className="text-omega-dim text-sm text-center py-8">
              Awaiting first transmission...
            </p>
          ) : (
            <>
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
                    entityRefs={seg.entityRefs}
                    stationImages={stationImages}
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
                <ChoiceCard title={choiceTitle ?? 'Suggested Actions'} choices={choices} onChoice={onChoice} />
              )}
            </>
          )}
          {/* Sentinel for IntersectionObserver — always at the bottom of content */}
          <div ref={sentinelRef} className="h-0" />
        </div>
      </div>

      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full
            bg-omega-surface/90 border border-omega-border text-omega-dim text-xs
            hover:text-omega-text hover:border-omega-accent transition-colors
            backdrop-blur-sm shadow-lg cursor-pointer"
        >
          New content below ↓
        </button>
      )}
    </div>
  );
}
