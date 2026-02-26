import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const {
  useMutationMock,
  useQueryMock,
  useScreenManagerMock,
  useGameSetupMock,
  goToTitleMock,
  goToRunSummaryMock,
  goToGameOverMock,
  nav,
} = vi.hoisted(() => {
  const goToTitleMock = vi.fn();
  const goToRunSummaryMock = vi.fn();
  const goToGameOverMock = vi.fn();
  const nav: {
    screen: { id: string; gameId?: string; stationId?: string };
    goToTitle: ReturnType<typeof vi.fn>;
    goToCharacterSelect: ReturnType<typeof vi.fn>;
    goToStationPicker: ReturnType<typeof vi.fn>;
    goToLoading: ReturnType<typeof vi.fn>;
    goToGameplay: ReturnType<typeof vi.fn>;
    goToGameOver: ReturnType<typeof vi.fn>;
    goToRunSummary: ReturnType<typeof vi.fn>;
    goToRunHistory: ReturnType<typeof vi.fn>;
  } = {
    screen: { id: 'title' },
    goToTitle: goToTitleMock,
    goToCharacterSelect: vi.fn(),
    goToStationPicker: vi.fn(),
    goToLoading: vi.fn(),
    goToGameplay: vi.fn(),
    goToGameOver: goToGameOverMock,
    goToRunSummary: goToRunSummaryMock,
    goToRunHistory: vi.fn(),
  };

  return {
    useMutationMock: vi.fn(),
    useQueryMock: vi.fn(),
    useScreenManagerMock: vi.fn(),
    useGameSetupMock: vi.fn(),
    goToTitleMock,
    goToRunSummaryMock,
    goToGameOverMock,
    nav,
  };
});

vi.mock('convex/react', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('./hooks/useScreenManager', () => ({
  useScreenManager: useScreenManagerMock,
}));

vi.mock('./hooks/useGameSetup', () => ({
  useGameSetup: useGameSetupMock,
}));

vi.mock('./screens/TitleScreen', () => ({
  TitleScreen: () => null,
}));

vi.mock('./screens/CharacterSelectScreen', () => ({
  CharacterSelectScreen: () => null,
}));

vi.mock('./screens/StationPickerScreen', () => ({
  StationPickerScreen: () => null,
}));

vi.mock('./screens/LoadingScreen', () => ({
  LoadingScreen: () => null,
}));

vi.mock('./screens/GameplayScreen', () => ({
  GameplayScreen: () => null,
}));

vi.mock('./screens/GameOverScreen', () => ({
  GameOverScreen: () => null,
}));

vi.mock('./screens/RunSummaryScreen', () => ({
  RunSummaryScreen: () => null,
}));

vi.mock('./screens/RunHistoryScreen', () => ({
  RunHistoryScreen: () => null,
}));

describe('App resume redirect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.screen = { id: 'title' };

    useMutationMock.mockReturnValue(vi.fn());
    useScreenManagerMock.mockReturnValue(nav);
    useGameSetupMock.mockReturnValue({
      selectedClass: null,
      selectedDifficulty: 'normal',
      selectClass: vi.fn(),
      selectDifficulty: vi.fn(),
    });
  });

  it('[Z] redirects to title when a restored gameplay run resolves to no game document', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };
    useQueryMock.mockReturnValue(null);

    render(<App />);

    await waitFor(() => {
      expect(goToTitleMock).toHaveBeenCalledTimes(1);
    });
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[O] does not immediately redirect one ended winning gameplay run from app shell', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };
    useQueryMock.mockReturnValue({ isOver: true, won: true });

    render(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[M] handles many gameplay query states without app-shell terminal redirects', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };

    useQueryMock
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ isOver: false, won: false })
      .mockReturnValue({ isOver: true, won: false });

    const view = render(<App />);
    view.rerender(<App />);
    view.rerender(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(3);
    });
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[B] does not redirect while gameplay query is still loading at the undefined boundary', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };
    useQueryMock.mockReturnValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[I] passes the skip interface sentinel to useQuery when screen is not gameplay', async () => {
    nav.screen = { id: 'title' };
    useQueryMock.mockReturnValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(1);
    });
    const queryArgs = useQueryMock.mock.calls[0];
    expect(queryArgs[1]).toBe('skip');
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[E] tolerates malformed gameplay docs without throwing and without terminal redirects', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };
    useQueryMock.mockReturnValue({ won: true });

    render(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });

  it('[S] keeps standard active gameplay on gameplay screen without redirecting', async () => {
    nav.screen = {
      id: 'gameplay',
      gameId: 'j9733s5p0przppv68h942xqd6n81nxmb',
      stationId: 'k179vww2j4ets2zbf4nacbg8sx81n06m',
    };
    useQueryMock.mockReturnValue({ isOver: false, won: false });

    render(<App />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(goToTitleMock).not.toHaveBeenCalled();
    expect(goToRunSummaryMock).not.toHaveBeenCalled();
    expect(goToGameOverMock).not.toHaveBeenCalled();
  });
});
