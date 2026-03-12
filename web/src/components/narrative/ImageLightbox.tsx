import { useEffect, useCallback } from 'react';
import type { StationImage } from '../../hooks/useStationImages';
import { IMAGE_CATEGORY_LABELS } from '../../engine/segmentStyles';

interface ImageLightboxProps {
  image: StationImage;
  onClose: () => void;
}

export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, [handleKeyDown]);

  const label = IMAGE_CATEGORY_LABELS[image.category] ?? 'SIGNAL';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-pointer"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-w-[90vw] max-h-[80vh] cursor-default sm:max-w-3xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <img
          src={image.url}
          alt=""
          className="w-full h-full object-contain"
        />

        {/* Scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.06,
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.4) 3px, rgba(0,0,0,0.4) 5px)',
          }}
        />

        {/* CRT vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)',
          }}
        />

        {/* Category label */}
        <div className="absolute bottom-2 right-3 text-[9px] tracking-widest uppercase text-omega-dim pointer-events-none" style={{ opacity: 0.5 }}>
          [{label}]
        </div>

        {/* Close hint */}
        <button
          type="button"
          className="absolute top-2 right-3 text-[10px] text-omega-dim cursor-pointer hover:text-omega-text transition-colors bg-transparent border-none p-0"
          style={{ opacity: 0.6 }}
          onClick={onClose}
        >
          [ESC]
        </button>
      </div>
    </div>
  );
}
