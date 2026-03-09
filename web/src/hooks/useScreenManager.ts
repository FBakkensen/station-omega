import { useReducer, useCallback, useEffect } from 'react';
import type { Id } from '../../../convex/_generated/dataModel';

/** All screens in the game flow. */
type Screen =
  | { id: 'title' }
  | { id: 'character_select' }
  | { id: 'station_picker' }
  | { id: 'loading'; progressId: Id<"generationProgress"> }
  | { id: 'gameplay'; gameId: string; stationId: string }
  | { id: 'game_over'; gameId: string }
  | { id: 'run_summary'; gameId: string }
  | { id: 'run_history' };

type GameplayScreen = Extract<Screen, { id: 'gameplay' }>;

const STORAGE_KEY = 'station-omega-screen';
const STORAGE_VERSION = 1;
const DEFAULT_SCREEN: Screen = { id: 'title' };
const CONVEX_ID_RE = /^[a-z0-9]{32}$/;

interface PersistedScreen {
  version: number;
  screen: GameplayScreen;
}

function isPersistedGameplayScreen(value: unknown): value is PersistedScreen {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.version !== STORAGE_VERSION) return false;
  if (typeof candidate.screen !== 'object' || candidate.screen === null) return false;

  const screen = candidate.screen as Record<string, unknown>;
  if (screen.id !== 'gameplay') return false;
  if (typeof screen.gameId !== 'string' || typeof screen.stationId !== 'string') return false;

  return CONVEX_ID_RE.test(screen.gameId) && CONVEX_ID_RE.test(screen.stationId);
}

function loadPersistedScreen(): Screen | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedGameplayScreen(parsed)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed.screen;
  } catch {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    return null;
  }
}

function savePersistedScreen(screen: GameplayScreen): void {
  if (typeof window === 'undefined') return;

  const payload: PersistedScreen = {
    version: STORAGE_VERSION,
    screen,
  };

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function clearPersistedScreen(): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

type Action =
  | { type: 'GO_CHARACTER_SELECT' }
  | { type: 'GO_STATION_PICKER' }
  | { type: 'GO_LOADING'; progressId: Id<"generationProgress"> }
  | { type: 'GO_GAMEPLAY'; gameId: string; stationId: string }
  | { type: 'GO_GAME_OVER'; gameId: string }
  | { type: 'GO_RUN_SUMMARY'; gameId: string }
  | { type: 'GO_RUN_HISTORY' }
  | { type: 'GO_TITLE' };

function reducer(_state: Screen, action: Action): Screen {
  let next: Screen;
  switch (action.type) {
    case 'GO_TITLE':
      next = { id: 'title' }; break;
    case 'GO_CHARACTER_SELECT':
      next = { id: 'character_select' }; break;
    case 'GO_STATION_PICKER':
      next = { id: 'station_picker' }; break;
    case 'GO_LOADING':
      next = { id: 'loading', progressId: action.progressId }; break;
    case 'GO_GAMEPLAY':
      next = { id: 'gameplay', gameId: action.gameId, stationId: action.stationId }; break;
    case 'GO_GAME_OVER':
      next = { id: 'game_over', gameId: action.gameId }; break;
    case 'GO_RUN_SUMMARY':
      next = { id: 'run_summary', gameId: action.gameId }; break;
    case 'GO_RUN_HISTORY':
      next = { id: 'run_history' }; break;
  }
  console.log('[ScreenManager]', _state.id, '→', next.id, action);
  return next;
}

interface ScreenManager {
  screen: Screen;
  goToTitle: () => void;
  goToCharacterSelect: () => void;
  goToStationPicker: () => void;
  goToLoading: (progressId: Id<"generationProgress">) => void;
  goToGameplay: (gameId: string, stationId: string) => void;
  goToGameOver: (gameId: string) => void;
  goToRunSummary: (gameId: string) => void;
  goToRunHistory: () => void;
}

export function useScreenManager(): ScreenManager {
  const [screen, dispatch] = useReducer(
    reducer,
    DEFAULT_SCREEN,
    () => loadPersistedScreen() ?? DEFAULT_SCREEN,
  );

  useEffect(() => {
    if (screen.id === 'gameplay') {
      savePersistedScreen(screen);
      return;
    }
    clearPersistedScreen();
  }, [screen]);

  return {
    screen,
    goToTitle: useCallback(() => { dispatch({ type: 'GO_TITLE' }); }, []),
    goToCharacterSelect: useCallback(() => { dispatch({ type: 'GO_CHARACTER_SELECT' }); }, []),
    goToStationPicker: useCallback(() => { dispatch({ type: 'GO_STATION_PICKER' }); }, []),
    goToLoading: useCallback((progressId: Id<"generationProgress">) => { dispatch({ type: 'GO_LOADING', progressId }); }, []),
    goToGameplay: useCallback((gameId: string, stationId: string) => { dispatch({ type: 'GO_GAMEPLAY', gameId, stationId }); }, []),
    goToGameOver: useCallback((gameId: string) => { dispatch({ type: 'GO_GAME_OVER', gameId }); }, []),
    goToRunSummary: useCallback((gameId: string) => { dispatch({ type: 'GO_RUN_SUMMARY', gameId }); }, []),
    goToRunHistory: useCallback(() => { dispatch({ type: 'GO_RUN_HISTORY' }); }, []),
  };
}
