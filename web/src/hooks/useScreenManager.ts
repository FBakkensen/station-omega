import { useReducer, useCallback } from 'react';
import type { Id } from '../../../convex/_generated/dataModel';

/** All screens in the game flow. */
export type Screen =
  | { id: 'title' }
  | { id: 'character_select' }
  | { id: 'station_picker' }
  | { id: 'loading'; progressId: Id<"generationProgress"> }
  | { id: 'gameplay'; gameId: string; stationId: string }
  | { id: 'game_over'; gameId: string }
  | { id: 'run_summary'; gameId: string }
  | { id: 'run_history' };

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

export interface ScreenManager {
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
  const [screen, dispatch] = useReducer(reducer, { id: 'title' });

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
