import { useQuery, useMutation } from 'convex/react';
import { useEffect, useRef } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { computeScore } from '../engine/scoring';
import type { RunScore, RunMetrics } from '../engine/scoring';
import { GRADE_COLORS } from '../styles/theme';
import { formatCost, type CostSummary } from '../utils/format';

/** Loose shape of the game document from Convex (state is v.any()). */
interface SummaryGameDoc {
  stationId: Id<"stations">;
  characterClass: "engineer" | "scientist" | "medic" | "commander";
  difficulty: "normal" | "hard" | "nightmare";
  won: boolean;
  turnCount: number;
  state?: {
    metrics?: RunMetrics;
  };
}

/** Loose shape of the station document from Convex (data is v.any()). */
interface SummaryStationDoc {
  data?: {
    rooms?: Record<string, unknown>;
  };
}

interface RunSummaryScreenProps {
  gameId: string;
  onTitle: () => void;
  onHistory: () => void;
}

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-omega-dim text-xs w-28">{label}</span>
      <div className="flex-1 h-2 bg-omega-border overflow-hidden">
        <div
          className="h-full bg-omega-title transition-all duration-700"
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <span className="text-omega-text text-xs w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}

export function RunSummaryScreen({ gameId, onTitle, onHistory }: RunSummaryScreenProps) {
  const game = useQuery(api.games.get, { id: gameId as Id<"games"> }) as SummaryGameDoc | null | undefined;
  const stationId = game?.stationId;
  const station = useQuery(api.stations.get, stationId ? { id: stationId } : "skip") as SummaryStationDoc | null | undefined;
  const saveRun = useMutation(api.runHistory.save);
  const savedRef = useRef(false);

  const totalRooms = station?.data?.rooms ? Object.keys(station.data.rooms).length : 10;
  const costSummary = useQuery(
    api.aiLogs.gameCostSummary,
    stationId
      ? { gameId: gameId as Id<"games">, stationId }
      : "skip",
  ) as CostSummary | undefined;

  // Compute score from game metrics
  let score: RunScore | null = null;
  if (game?.state?.metrics) {
    score = computeScore(game.state.metrics, totalRooms);
  }

  // Save run to history once
  useEffect(() => {
    if (!score || !game || savedRef.current) return;
    savedRef.current = true;

    const metrics = game.state?.metrics;
    if (!metrics) return;

    void saveRun({
      gameId: gameId as Id<"games">,
      characterClass: game.characterClass,
      storyArc: metrics.storyArc,
      difficulty: game.difficulty,
      won: game.won,
      endingId: metrics.endingId,
      score: {
        speed: score.speed,
        engineeringEfficiency: score.engineeringEfficiency,
        exploration: score.exploration,
        resourcefulness: score.resourcefulness,
        completion: score.completion,
        total: score.total,
        grade: score.grade,
      },
      turnCount: game.turnCount,
      duration: (metrics.endTime ?? Date.now()) - metrics.startTime,
      date: new Date().toISOString(),
    });
  }, [score, game, gameId, saveRun]);

  if (!game || !score) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-omega-dim text-sm animate-pulse">Loading results...</p>
      </div>
    );
  }

  const gradeColor = GRADE_COLORS[score.grade] ?? '#c0c8d4';

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
      <h1 className="text-omega-title text-2xl tracking-wider uppercase">
        {game.won ? 'Mission Complete' : 'Mission Failed'}
      </h1>

      {/* Grade */}
      <div className="text-center">
        <div
          className="text-7xl font-bold"
          style={{ color: gradeColor }}
        >
          {score.grade}
        </div>
        <p className="text-omega-dim text-sm mt-1">
          {String(score.total)} / 500 points
        </p>
      </div>

      {/* Score breakdown */}
      <div className="w-full max-w-md space-y-2">
        <ScoreBar label="Speed" value={score.speed} />
        <ScoreBar label="Engineering" value={score.engineeringEfficiency} />
        <ScoreBar label="Exploration" value={score.exploration} />
        <ScoreBar label="Resourcefulness" value={score.resourcefulness} />
        <ScoreBar label="Completion" value={score.completion} />
      </div>

      {/* Stats */}
      <div className="text-omega-dim text-xs flex gap-6 mt-2">
        <span>Turns: {String(game.turnCount)}</span>
        <span>Class: {game.characterClass}</span>
        <span>Difficulty: {game.difficulty}</span>
        {costSummary?.totalCostUsd != null && (
          <span>AI Cost: {formatCost(costSummary.totalCostUsd)}</span>
        )}
      </div>

      <div className="flex gap-4 mt-4">
        <button
          onClick={onHistory}
          className="px-6 py-3 border border-omega-title text-omega-title
                     hover:bg-omega-title/10 transition-colors text-sm tracking-wider uppercase"
        >
          Run History
        </button>
        <button
          onClick={onTitle}
          className="px-6 py-3 border border-omega-border text-omega-dim
                     hover:border-omega-dim hover:text-omega-text
                     transition-colors text-sm tracking-wider uppercase"
        >
          Main Menu
        </button>
      </div>
    </div>
  );
}
