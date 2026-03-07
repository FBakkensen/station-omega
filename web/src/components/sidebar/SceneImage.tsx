import { useState } from 'react';
import type { StationImage } from '../../hooks/useStationImages';

interface SceneImageProps {
  image?: StationImage;
  stationName: string;
  roomName: string;
  roomIndex: number;
  totalRooms: number;
}

export function SceneImage({ image, stationName, roomName, roomIndex, totalRooms }: SceneImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Reset loaded state when image URL changes
  const [lastUrl, setLastUrl] = useState(image?.url);
  if (image?.url !== lastUrl) {
    setLastUrl(image?.url);
    setLoaded(false);
    setError(false);
  }

  const hasImage = image && !error;

  return (
    <div className="relative w-full flex-shrink-0 overflow-hidden border-b border-omega-border">
      {hasImage ? (
        <>
          {/* Loading shimmer */}
          {!loaded && (
            <div className="w-full h-56 bg-omega-surface animate-pulse" />
          )}

          <img
            src={image.url}
            alt={roomName}
            onLoad={() => { setLoaded(true); }}
            onError={() => { setError(true); }}
            className={`w-full h-56 object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0 absolute inset-0'}`}
          />

          {/* Scanline overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-10"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.4) 2px, rgba(0,0,0,0.4) 4px)',
            }}
          />

          {/* Room info below image */}
          <div className="px-4 py-2">
            <div className="text-omega-title text-xs tracking-wider uppercase truncate">{stationName}</div>
            <div className="text-omega-dim text-xs">
              {roomName} ({roomIndex}/{totalRooms})
            </div>
          </div>
        </>
      ) : (
        /* Fallback: text-only header when no image */
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-omega-title text-xs tracking-wider uppercase truncate">{stationName}</span>
            <span className="text-omega-dim text-xs">
              {roomName} ({roomIndex}/{totalRooms})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
