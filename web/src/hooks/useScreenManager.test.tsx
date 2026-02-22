import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScreenManager } from './useScreenManager';

const STORAGE_KEY = 'station-omega-screen';
const VALID_GAME_ID = 'j9733s5p0przppv68h942xqd6n81nxmb';
const VALID_STATION_ID = 'k179vww2j4ets2zbf4nacbg8sx81n06m';

describe('useScreenManager', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('[Z] starts on the title screen when no persisted gameplay exists', () => {
    const { result } = renderHook(() => useScreenManager());
    expect(result.current.screen).toEqual({ id: 'title' });
  });

  it('[O] restores one persisted gameplay screen from session storage', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        screen: { id: 'gameplay', gameId: VALID_GAME_ID, stationId: VALID_STATION_ID },
      }),
    );

    const { result } = renderHook(() => useScreenManager());
    expect(result.current.screen).toEqual({
      id: 'gameplay',
      gameId: VALID_GAME_ID,
      stationId: VALID_STATION_ID,
    });
  });

  it('[M] clears persisted gameplay after a multi-step navigation leaves gameplay', () => {
    const { result } = renderHook(() => useScreenManager());

    act(() => {
      result.current.goToGameplay('game_1', 'station_1');
      result.current.goToRunSummary('game_1');
    });

    expect(result.current.screen).toEqual({ id: 'run_summary', gameId: 'game_1' });
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('[B] handles loading transition with an explicit progress id boundary value', () => {
    const { result } = renderHook(() => useScreenManager());
    act(() => {
      result.current.goToLoading('progress_0' as never);
    });
    expect(result.current.screen).toEqual({ id: 'loading', progressId: 'progress_0' });
  });

  it('[I] exposes interface methods and persists the gameplay payload contract', () => {
    const { result } = renderHook(() => useScreenManager());
    expect(typeof result.current.goToTitle).toBe('function');
    expect(typeof result.current.goToGameplay).toBe('function');
    expect(typeof result.current.goToRunHistory).toBe('function');

    act(() => {
      result.current.goToGameplay('game_9', 'station_9');
    });

    const persisted = window.sessionStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted as string)).toEqual({
      version: 1,
      screen: { id: 'gameplay', gameId: 'game_9', stationId: 'station_9' },
    });
  });

  it('[E] ignores malformed persisted payloads and falls back to title', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        screen: { id: 'gameplay', gameId: 'bad', stationId: 'also-bad' },
      }),
    );

    const { result } = renderHook(() => useScreenManager());
    expect(result.current.screen).toEqual({ id: 'title' });
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
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
