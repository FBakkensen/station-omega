import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScreenManager } from './useScreenManager';

describe('useScreenManager', () => {
  it('[Z] starts on the title screen by default', () => {
    const { result } = renderHook(() => useScreenManager());
    expect(result.current.screen).toEqual({ id: 'title' });
  });

  it('[O] transitions to character select', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToCharacterSelect();
    });
    expect(result.current.screen).toEqual({ id: 'character_select' });
  });

  it('[M] supports full multi-step navigation flows', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToStationPicker();
      result.current.goToGameplay('game_1', 'station_1');
      result.current.goToRunSummary('game_1');
    });
    expect(result.current.screen).toEqual({ id: 'run_summary', gameId: 'game_1' });
  });

  it('[B] handles loading transition with an explicit progress id boundary value', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToLoading('progress_0' as never);
    });
    expect(result.current.screen).toEqual({ id: 'loading', progressId: 'progress_0' });
  });

  it('[I] exposes the expected navigation interface methods', () => {
    const { result } = renderHook(() => useScreenManager());
    expect(typeof result.current.goToTitle).toBe('function');
    expect(typeof result.current.goToGameplay).toBe('function');
    expect(typeof result.current.goToRunHistory).toBe('function');
  });

  it('[E] tolerates empty identifiers without throwing', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToGameOver('');
    });
    expect(result.current.screen).toEqual({ id: 'game_over', gameId: '' });
  });

  it('[S] returns to run history from arbitrary state', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToGameplay('game_5', 'station_2');
      result.current.goToRunHistory();
    });
    expect(result.current.screen).toEqual({ id: 'run_history' });
  });
});
