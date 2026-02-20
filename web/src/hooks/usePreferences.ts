import { useState } from 'react';

const STORAGE_KEY = 'station-omega-preferences';

interface Preferences {
  soundEnabled: boolean;
}

const DEFAULTS: Preferences = {
  soundEnabled: false,
};

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'soundEnabled' in parsed) {
      const p = parsed as Record<string, unknown>;
      return { soundEnabled: p.soundEnabled === true };
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
  const [soundEnabled, setSoundEnabledState] = useState(() => loadPreferences().soundEnabled);

  const setSoundEnabled = (enabled: boolean) => {
    setSoundEnabledState(enabled);
    savePreferences({ soundEnabled: enabled });
  };

  return { soundEnabled, setSoundEnabled } as const;
}
