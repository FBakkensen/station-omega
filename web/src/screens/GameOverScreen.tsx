interface GameOverScreenProps {
  gameId: string;
  onSummary: () => void;
  onTitle: () => void;
}

export function GameOverScreen({ gameId, onSummary, onTitle }: GameOverScreenProps) {
  console.log('[GameOverScreen] render, gameId:', gameId);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h1 className="text-hp-low text-2xl tracking-wider uppercase">Mission Failed</h1>
      <p className="text-omega-dim text-sm max-w-md text-center">
        The station claims another soul. Your story ends here — but the data lives on.
      </p>
      <div className="flex gap-4">
        <button
          onClick={onSummary}
          className="px-6 py-3 border border-omega-title text-omega-title
                     hover:bg-omega-title/10 transition-colors text-sm tracking-wider uppercase"
        >
          View Summary
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
