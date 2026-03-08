/** Shape of the cost summary returned by `gameCostSummary` query. */
export interface CostSummary {
  generation: { count: number; costUsd: number };
  turns: { count: number; costUsd: number; inputTokens: number; outputTokens: number };
  images: { count: number; costUsd: number; cacheHits: number };
  video: { count: number; costUsd: number };
  tts: { count: number; costUsd: number; totalChars: number };
  totalCostUsd: number;
}

/** Format a USD cost for display, showing '<$0.001' for tiny amounts. */
export function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  return `$${usd.toFixed(3)}`;
}
