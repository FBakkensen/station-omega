import { usePreferences, GAME_MASTER_MODELS } from '../hooks/usePreferences';

interface TitleScreenProps {
  onNewGame: () => void;
  onHistory: () => void;
}

const TITLE_ART = [
  ' ███████╗████████╗ █████╗ ████████╗██╗ ██████╗ ███╗   ██╗',
  ' ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║',
  ' ███████╗   ██║   ███████║   ██║   ██║██║   ██║██╔██╗ ██║',
  ' ╚════██║   ██║   ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║',
  ' ███████║   ██║   ██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║',
  ' ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝',
  '            ██████╗ ███╗   ███╗███████╗ ██████╗  █████╗',
  '           ██╔═══██╗████╗ ████║██╔════╝██╔════╝ ██╔══██╗',
  '           ██║   ██║██╔████╔██║█████╗  ██║  ███╗███████║',
  '           ██║   ██║██║╚██╔╝██║██╔══╝  ██║   ██║██╔══██║',
  '           ╚██████╔╝██║ ╚═╝ ██║███████╗╚██████╔╝██║  ██║',
  '            ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝',
];

export function TitleScreen({ onNewGame, onHistory }: TitleScreenProps) {
  const { soundEnabled, setSoundEnabled, gameMasterModelId, setGameMasterModelId } = usePreferences();

  const currentModelLabel = GAME_MASTER_MODELS.find(m => m.id === gameMasterModelId)?.label ?? gameMasterModelId;
  const cycleModel = () => {
    const idx = GAME_MASTER_MODELS.findIndex(m => m.id === gameMasterModelId);
    const next = GAME_MASTER_MODELS[(idx + 1) % GAME_MASTER_MODELS.length];
    setGameMasterModelId(next.id);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-12">
      {/* ASCII Art Title */}
      <pre className="text-omega-title text-xs sm:text-sm leading-tight select-none">
        {TITLE_ART.join('\n')}
      </pre>

      {/* Subtitle */}
      <p className="text-omega-dim text-sm tracking-widest uppercase">
        AI-Powered Space Station Survival
      </p>

      {/* Menu Buttons */}
      <div className="flex flex-col gap-4 w-64">
        <button
          onClick={onNewGame}
          className="px-6 py-3 border border-omega-title text-omega-title
                     hover:bg-omega-title/10 transition-colors duration-200
                     tracking-wider uppercase text-sm"
        >
          New Game
        </button>
        <button
          onClick={onHistory}
          className="px-6 py-3 border border-omega-border text-omega-dim
                     hover:border-omega-dim hover:text-omega-text
                     transition-colors duration-200
                     tracking-wider uppercase text-sm"
        >
          Run History
        </button>
      </div>

      {/* Settings */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => { setSoundEnabled(!soundEnabled); }}
          className={`text-xs tracking-wider uppercase transition-colors ${
            soundEnabled ? 'text-omega-title' : 'text-omega-dim hover:text-omega-text'
          }`}
        >
          {soundEnabled ? 'Sound: ON' : 'Sound: OFF'}
        </button>
        <button
          onClick={cycleModel}
          className="text-xs tracking-wider uppercase transition-colors text-omega-dim hover:text-omega-text"
        >
          Model: {currentModelLabel}
        </button>
      </div>

      {/* Version */}
      <p className="text-omega-dim/50 text-xs">
        v1.0 — Powered by AI
      </p>
    </div>
  );
}
