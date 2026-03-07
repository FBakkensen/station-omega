import { useState } from 'react';

interface TurnImageProps {
  url: string;
  alt: string;
  category: 'room_scene' | 'npc_portrait' | 'briefing';
}

export function TurnImage({ url, alt, category }: TurnImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) return null;

  const isPortrait = category === 'npc_portrait';

  if (isPortrait) {
    return (
      <div className="relative w-16 h-16 rounded-sm flex-shrink-0 overflow-hidden border border-omega-border">
        {!loaded && (
          <div className="absolute inset-0 bg-omega-surface animate-pulse rounded-sm" />
        )}
        <img
          src={url}
          alt={alt}
          onLoad={() => { setLoaded(true); }}
          onError={() => { setError(true); }}
          className={`w-full h-full object-cover rounded-sm transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    );
  }

  // Room scene / briefing: wide banner with cinematic crop
  return (
    <div className="relative w-full mb-3 rounded overflow-hidden border border-omega-border">
      {/* Scanline overlay for retro CRT effect */}
      <div
        className="absolute inset-0 z-10 pointer-events-none opacity-15"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.4) 2px, rgba(0,0,0,0.4) 4px)',
        }}
      />

      {/* Top/bottom vignette for blending into dark UI */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, rgba(10,14,20,0.4) 0%, transparent 20%, transparent 80%, rgba(10,14,20,0.6) 100%)',
        }}
      />

      {/* Loading shimmer */}
      {!loaded && (
        <div className="absolute inset-0 bg-omega-surface animate-pulse" />
      )}

      <img
        src={url}
        alt={alt}
        onLoad={() => { setLoaded(true); }}
        onError={() => { setError(true); }}
        className={`w-full h-40 object-cover transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
