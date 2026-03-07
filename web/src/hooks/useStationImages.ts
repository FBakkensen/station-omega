import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

export interface StationImage {
  cacheKey: string;
  url: string;
  category: string;
}

export function useGameImages(gameId: string, stationId: string) {
  const rawImages = useQuery(api.stationImages.listForGame, {
    gameId: gameId as Id<"games">,
    stationId: stationId as Id<"stations">,
  });

  const imageMap = useMemo(() => {
    const map = new Map<string, StationImage>();
    if (!rawImages) return map;
    for (const img of rawImages as Array<{ cacheKey: string; url: string | null; category: string }>) {
      if (img.url) {
        map.set(img.cacheKey, {
          cacheKey: img.cacheKey,
          url: img.url,
          category: img.category,
        });
      }
    }
    return map;
  }, [rawImages]);

  return imageMap;
}
