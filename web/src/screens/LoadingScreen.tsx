import { useState, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface LoadingScreenProps {
  progressId: Id<"generationProgress">;
  onComplete: (stationId: string) => void;
  onError: () => void;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function LoadingScreen({ progressId, onComplete, onError }: LoadingScreenProps) {
  const [spinnerIdx, setSpinnerIdx] = useState(0);
  const progress = useQuery(api.generationProgress.get, { id: progressId });

  console.log('[LoadingScreen] render, progressId:', progressId, 'progress:', progress);

  useEffect(() => {
    const timer = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => { clearInterval(timer); };
  }, []);

  // React to completion/error
  useEffect(() => {
    console.log('[LoadingScreen] progress effect, progress:', progress);
    if (!progress) {
      console.log('[LoadingScreen] progress is null/undefined, waiting...');
      return;
    }
    console.log('[LoadingScreen] progress status:', progress.status, 'stationId:', progress.stationId, 'error:', progress.error);
    if (progress.status === 'complete' && progress.stationId) {
      console.log('[LoadingScreen] → calling onComplete with stationId:', progress.stationId);
      onComplete(progress.stationId);
    } else if (progress.status === 'error') {
      console.error('[LoadingScreen] → generation error:', progress.error, '→ calling onError');
      onError();
    }
  }, [progress, onComplete, onError]);

  const progressPct = progress?.progress ?? 0;
  const message = progress?.message ?? 'Initializing...';
  const error = progress?.error;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      {/* Spinner */}
      <div className="text-omega-title text-4xl font-mono">
        {SPINNER_FRAMES[spinnerIdx]}
      </div>

      {/* Status */}
      <div className="text-center">
        <h2 className="text-omega-title text-sm tracking-wider uppercase mb-4">
          Generating Station
        </h2>
        <p className="text-omega-dim text-xs">
          {message}
        </p>
        {error && (
          <p className="text-hp-low text-xs mt-2">
            Error: {error}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-64 h-1 bg-omega-border overflow-hidden">
        <div
          className="h-full bg-omega-title transition-all duration-500"
          style={{ width: `${String(progressPct)}%` }}
        />
      </div>

      {/* Stage indicator */}
      <div className="flex gap-2">
        {['topology', 'systems', 'objectives', 'creative', 'assembly'].map((stage) => {
          const stageOrder = ['pending', 'topology', 'systems', 'objectives', 'creative', 'assembly', 'complete'];
          const currentIdx = stageOrder.indexOf(progress?.status ?? 'pending');
          const stageIdx = stageOrder.indexOf(stage);
          const isActive = currentIdx === stageIdx;
          const isDone = currentIdx > stageIdx;

          return (
            <div
              key={stage}
              className={`w-2 h-2 rounded-full transition-colors ${
                isActive ? 'bg-omega-title' :
                isDone ? 'bg-omega-title/40' :
                'bg-omega-border'
              }`}
            />
          );
        })}
      </div>

      {/* Debug info */}
      <div className="text-omega-dim/30 text-[10px] mt-4">
        Progress ID: {progressId}
      </div>
    </div>
  );
}
