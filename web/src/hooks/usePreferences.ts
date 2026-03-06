import { useState } from 'react';
import { GAME_MASTER_MODEL_ID, GAME_MASTER_MODELS } from '../../../src/model-catalog.js';

const STORAGE_KEY = 'station-omega-preferences';

export { GAME_MASTER_MODELS };

interface Preferences {
  soundEnabled: boolean;
  gameMasterModelId: string;
}

const DEFAULTS: Preferences = {
  soundEnabled: false,
  gameMasterModelId: GAME_MASTER_MODEL_ID,
};

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'soundEnabled' in parsed) {
      const p = parsed as Record<string, unknown>;
      return {
        soundEnabled: p.soundEnabled === true,
        gameMasterModelId:
          typeof p.gameMasterModelId === 'string' && GAME_MASTER_MODELS.some(m => m.id === p.gameMasterModelId)
            ? p.gameMasterModelId
            : DEFAULTS.gameMasterModelId,
      };
    }
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private browsing, quota exceeded, etc.)
  }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState(loadPreferences);

  const setSoundEnabled = (enabled: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, soundEnabled: enabled };
      savePreferences(next);
      return next;
    });
  };

  const setGameMasterModelId = (modelId: string) => {
    setPrefs(prev => {
      const next = { ...prev, gameMasterModelId: modelId };
      savePreferences(next);
      return next;
    });
  };

  return {
    soundEnabled: prefs.soundEnabled,
    setSoundEnabled,
    gameMasterModelId: prefs.gameMasterModelId,
    setGameMasterModelId,
  } as const;
}
