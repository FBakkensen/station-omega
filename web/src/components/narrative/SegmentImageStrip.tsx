import { useState } from 'react';
import type { StationImage } from '../../hooks/useStationImages';
import { IMAGE_CATEGORY_LABELS } from '../../engine/segmentStyles';
import { ImageLightbox } from './ImageLightbox';

interface SegmentImageStripProps {
  images: StationImage[];
  finalized: boolean;
  cardBorderColor: string;
  cardBgColor: string;
}

function getImageStyle(category: string): { aspectRatio: string; objectPosition: string } {
  void category;
  return {
    aspectRatio: '16/9',
    objectPosition: 'center',
  };
}

function getFlexBasis(images: StationImage[], index: number): string {
  if (images.length === 1) return '100%';
  if (images.length === 2) {
    const isRoom = images[index].category === 'room_scene';
    const otherIsRoom = images[1 - index].category === 'room_scene';
    if (isRoom && !otherIsRoom) return '60%';
    if (!isRoom && otherIsRoom) return '40%';
    return '50%';
  }
  // 3+: first gets 50%, rest split remainder
  if (index === 0) return '50%';
  const pct = 50 / (images.length - 1);
  return `${pct.toString()}%`;
}

function CornerBrackets({ color }: { color: string }) {
  const style = (top: boolean, left: boolean): React.CSSProperties => ({
    position: 'absolute',
    width: 6,
    height: 6,
    pointerEvents: 'none',
    ...(top ? { top: 0 } : { bottom: 0 }),
    ...(left ? { left: 0 } : { right: 0 }),
    borderTop: top ? `1px solid ${color}88` : 'none',
    borderBottom: top ? 'none' : `1px solid ${color}88`,
    borderLeft: left ? `1px solid ${color}88` : 'none',
    borderRight: left ? 'none' : `1px solid ${color}88`,
  });

  return (
    <>
      <div style={style(true, true)} />
      <div style={style(true, false)} />
      <div style={style(false, true)} />
      <div style={style(false, false)} />
    </>
  );
}

interface ImagePanelProps {
  image: StationImage;
  flexBasis: string;
  cardBorderColor: string;
  cardBgColor: string;
  onClick: () => void;
  onError: () => void;
}

function ImagePanel({ image, flexBasis, cardBorderColor, cardBgColor, onClick, onError }: ImagePanelProps) {
  const [loaded, setLoaded] = useState(false);
  const imgStyle = getImageStyle(image.category);
  const label = IMAGE_CATEGORY_LABELS[image.category] ?? 'SIGNAL';

  return (
    <div
      className="relative overflow-hidden cursor-pointer"
      style={{ flexBasis, minWidth: 0 }}
      onClick={onClick}
    >
      {/* Loading skeleton */}
      {!loaded && (
        <div
          className="w-full animate-pulse"
          style={{ aspectRatio: imgStyle.aspectRatio, backgroundColor: `${cardBorderColor}22` }}
        />
      )}

      <img
        src={image.url}
        alt=""
        onLoad={() => { setLoaded(true); }}
        onError={onError}
        className={`w-full object-cover ${loaded ? 'opacity-100 image-strip-acquire' : 'opacity-0 absolute inset-0'} transition-opacity duration-500`}
        style={{
          aspectRatio: imgStyle.aspectRatio,
          objectPosition: imgStyle.objectPosition,
        }}
      />

      {/* Top gradient fade — blends image edge into card background */}
      <div
        className="absolute top-0 left-0 right-0 h-3 pointer-events-none"
        style={{ background: `linear-gradient(to bottom, ${cardBgColor}, transparent)` }}
      />

      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.08,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.4) 3px, rgba(0,0,0,0.4) 5px)',
        }}
      />

      {/* CRT vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)' }}
      />

      {/* Phosphor glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ boxShadow: `inset 0 0 20px ${cardBorderColor}26` }}
      />

      {/* Corner bracket chrome */}
      <CornerBrackets color={cardBorderColor} />

      {/* Data tag label */}
      <div
        className="absolute bottom-1.5 right-2 text-[9px] tracking-widest uppercase pointer-events-none"
        style={{ color: `${cardBorderColor}99` }}
      >
        {label}
      </div>

      {/* Signal acquisition scan beam (plays once on mount when loaded) */}
      {loaded && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="image-strip-scan-beam" />
        </div>
      )}
    </div>
  );
}

export function SegmentImageStrip({ images, finalized, cardBorderColor, cardBgColor }: SegmentImageStripProps) {
  const [lightboxImage, setLightboxImage] = useState<StationImage | null>(null);
  const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set());

  const validImages = images.filter((img) => !errorKeys.has(img.cacheKey));

  // Hidden during typewriter reveal, or if no valid images
  if (!finalized || validImages.length === 0) return null;

  const handleError = (cacheKey: string) => {
    setErrorKeys((prev) => new Set(prev).add(cacheKey));
  };

  return (
    <>
      <div className="mt-2 flex gap-1" style={{ borderTop: `1px solid ${cardBorderColor}33` }}>
        {validImages.map((img, i) => (
          <ImagePanel
            key={img.cacheKey}
            image={img}
            flexBasis={getFlexBasis(validImages, i)}
            cardBorderColor={cardBorderColor}
            cardBgColor={cardBgColor}
            onClick={() => { setLightboxImage(img); }}
            onError={() => { handleError(img.cacheKey); }}
          />
        ))}
      </div>

      {lightboxImage && (
        <ImageLightbox image={lightboxImage} onClose={() => { setLightboxImage(null); }} />
      )}
    </>
  );
}
