import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { GRADE_COLORS } from '../styles/theme';

interface RunHistoryScreenProps {
  onBack: () => void;
}

interface RunEntry {
  _id: string;
  characterClass: string;
  difficulty: string;
  won: boolean;
  score: {
    total: number;
    grade: string;
  };
  turnCount: number;
  duration: number;
  date: string;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes)}m ${String(seconds)}s`;
}

export function RunHistoryScreen({ onBack }: RunHistoryScreenProps) {
  const entries = useQuery(api.runHistory.list) as RunEntry[] | undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-omega-border">
        <button
          onClick={onBack}
          className="text-omega-dim hover:text-omega-text transition-colors text-sm"
        >
          &larr; Back
        </button>
        <h1 className="text-omega-title text-lg tracking-wider uppercase">Run History</h1>
        <div className="w-16" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!entries ? (
          <p className="text-omega-dim text-sm text-center animate-pulse">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-omega-dim text-sm text-center py-8">
            No completed runs yet. Start a mission to see your history here.
          </p>
        ) : (
          <div className="max-w-2xl mx-auto space-y-2">
            {entries.map((entry) => {
              const gradeColor = GRADE_COLORS[entry.score.grade] ?? '#c0c8d4';
              return (
                <div
                  key={entry._id}
                  className="flex items-center gap-4 px-4 py-3 border border-omega-border hover:border-omega-title/30 transition-colors"
                >
                  {/* Grade */}
                  <span
                    className="text-2xl font-bold w-10 text-center"
                    style={{ color: gradeColor }}
                  >
                    {entry.score.grade}
                  </span>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-omega-text text-sm capitalize">{entry.characterClass}</span>
                      <span className="text-omega-dim text-xs">•</span>
                      <span className="text-omega-dim text-xs capitalize">{entry.difficulty}</span>
                      <span className="text-omega-dim text-xs">•</span>
                      <span className={`text-xs ${entry.won ? 'text-green-400' : 'text-hp-low'}`}>
                        {entry.won ? 'Victory' : 'Defeat'}
                      </span>
                    </div>
                    <div className="text-omega-dim text-xs mt-0.5">
                      {String(entry.score.total)} pts • {String(entry.turnCount)} turns • {formatDuration(entry.duration)}
                    </div>
                  </div>

                  {/* Date */}
                  <span className="text-omega-dim text-xs whitespace-nowrap">
                    {new Date(entry.date).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
