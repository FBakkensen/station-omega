import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the model catalog — must be before the dynamic import
vi.mock('../../../src/model-catalog.js', () => ({
  GAME_MASTER_MODEL_ID: 'google/gemini-3-flash-preview',
  GAME_MASTER_MODELS: [
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
  ],
}));

import { usePreferences } from './usePreferences';

beforeEach(() => {
  localStorage.clear();
});

describe('usePreferences functional state updates', () => {
  it('[Z] returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current.soundEnabled).toBe(false);
    expect(result.current.gameMasterModelId).toBe('google/gemini-3-flash-preview');
  });

  it('[O] persists a single preference change', () => {
    const { result } = renderHook(() => usePreferences());

    act(() => {
      result.current.setSoundEnabled(true);
    });

    expect(result.current.soundEnabled).toBe(true);
    const raw = localStorage.getItem('station-omega-preferences');
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string) as Record<string, unknown>;
    expect(stored.soundEnabled).toBe(true);
  });

  it('[M] preserves both updates when multiple setters are called in the same act', () => {
    const { result } = renderHook(() => usePreferences());

    act(() => {
      result.current.setSoundEnabled(true);
      result.current.setGameMasterModelId('google/gemini-3.1-flash-lite-preview');
    });

    // Both should be reflected — this catches the stale closure bug
    expect(result.current.soundEnabled).toBe(true);
    expect(result.current.gameMasterModelId).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('[B] handles boundary toggling sound back and forth within one act', () => {
    const { result } = renderHook(() => usePreferences());

    act(() => {
      result.current.setSoundEnabled(true);
      result.current.setSoundEnabled(false);
    });

    expect(result.current.soundEnabled).toBe(false);
  });

  it('[I] preserves the return type contract across updates', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current).toHaveProperty('soundEnabled');
    expect(result.current).toHaveProperty('setSoundEnabled');
    expect(result.current).toHaveProperty('gameMasterModelId');
    expect(result.current).toHaveProperty('setGameMasterModelId');
    expect(typeof result.current.setSoundEnabled).toBe('function');
    expect(typeof result.current.setGameMasterModelId).toBe('function');
  });

  it('[E] falls back to defaults when localStorage contains malformed data', () => {
    localStorage.setItem('station-omega-preferences', 'not-json!!!');

    const { result } = renderHook(() => usePreferences());

    expect(result.current.soundEnabled).toBe(false);
    expect(result.current.gameMasterModelId).toBe('google/gemini-3-flash-preview');
  });

  it('[S] produces stable localStorage state after sequential updates', () => {
    const { result } = renderHook(() => usePreferences());

    act(() => {
      result.current.setSoundEnabled(true);
      result.current.setGameMasterModelId('google/gemini-3.1-flash-lite-preview');
    });

    const raw = localStorage.getItem('station-omega-preferences');
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string) as Record<string, unknown>;
    expect(stored.soundEnabled).toBe(true);
    expect(stored.gameMasterModelId).toBe('google/gemini-3.1-flash-lite-preview');
  });
});
