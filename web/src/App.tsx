import { useCallback, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { useScreenManager } from './hooks/useScreenManager';
import { useGameSetup } from './hooks/useGameSetup';
import { TitleScreen } from './screens/TitleScreen';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { StationPickerScreen } from './screens/StationPickerScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { GameplayScreen } from './screens/GameplayScreen';
import { GameOverScreen } from './screens/GameOverScreen';
import { RunSummaryScreen } from './screens/RunSummaryScreen';
import { RunHistoryScreen } from './screens/RunHistoryScreen';

export function App() {
  const nav = useScreenManager();
  const setup = useGameSetup();
  const startGeneration = useMutation(api.stationGeneration.start);
  const createGame = useMutation(api.games.create);
  const { goToTitle } = nav;

  const gameplayScreen = nav.screen.id === 'gameplay' ? nav.screen : null;
  const gameplayDoc = useQuery(
    api.games.get,
    gameplayScreen
      ? { id: gameplayScreen.gameId as Id<"games"> }
      : 'skip',
  ) as { isOver: boolean; won: boolean } | null | undefined;

  useEffect(() => {
    if (!gameplayScreen) return;
    if (gameplayDoc === undefined) return;

    if (!gameplayDoc) {
      goToTitle();
    }
  }, [gameplayScreen, gameplayDoc, goToTitle]);

  const handleGenerate = useCallback(async () => {
    console.log('[App] handleGenerate called, selectedClass:', setup.selectedClass, 'difficulty:', setup.selectedDifficulty);
    if (!setup.selectedClass) {
      console.warn('[App] handleGenerate: no selectedClass, aborting');
      return;
    }
    try {
      console.log('[App] calling startGeneration mutation...');
      const progressId = await startGeneration({
        difficulty: setup.selectedDifficulty,
        characterClass: setup.selectedClass,
      });
      console.log('[App] generation started, progressId:', progressId);
      nav.goToLoading(progressId);
    } catch (err) {
      console.error('[App] handleGenerate error:', err);
    }
  }, [setup.selectedClass, setup.selectedDifficulty, startGeneration, nav]);

  const handleStartGame = useCallback(async (stationId: string) => {
    console.log('[App] handleStartGame called, stationId:', stationId, 'selectedClass:', setup.selectedClass);
    if (!setup.selectedClass) {
      console.warn('[App] handleStartGame: no selectedClass, aborting');
      return;
    }

    // Create initial game state (serialized — Sets as arrays, Maps as records)
    const initialState = {
      hp: setup.selectedClass === 'medic' ? 110 : (setup.selectedClass === 'scientist' ? 85 : 100),
      maxHp: setup.selectedClass === 'medic' ? 110 : (setup.selectedClass === 'scientist' ? 85 : 100),
      oxygen: 100,
      maxOxygen: 100,
      suitIntegrity: 100,
      inventory: [],
      maxInventory: setup.selectedClass === 'engineer' ? 6 : 5,
      currentRoom: '', // Will be set from station data
      roomsVisited: [],
      itemsTaken: [],
      revealedItems: [],
      hasObjectiveItem: false,
      gameOver: false,
      won: false,
      repairedSystems: [],
      craftedItems: [],
      systemsCascaded: 0,
      improvizedSolutions: 0,
      roomVisitCount: {},
      turnCount: 0,
      moveCount: 0,
      characterClass: setup.selectedClass,
      activeEvents: [],
      moralProfile: {
        choices: [],
        tendencies: { mercy: 0, sacrifice: 0, pragmatic: 0 },
        endingFlags: [],
      },
      metrics: {
        runId: crypto.randomUUID(),
        characterClass: setup.selectedClass,
        storyArc: 'cascade_failure',
        difficulty: setup.selectedDifficulty,
        startTime: Date.now(),
        endTime: null,
        turnCount: 0,
        missionElapsedMinutes: 0,
        moveCount: 0,
        totalDamageTaken: 0,
        totalDamageHealed: 0,
        roomsVisited: [],
        itemsUsed: [],
        itemsCollected: [],
        crewLogsFound: 0,
        creativeActionsAttempted: 0,
        npcInteractions: 0,
        deathCause: null,
        won: false,
        endingId: null,
        systemsDiagnosed: 0,
        systemsRepaired: 0,
        systemsCascaded: 0,
        itemsCrafted: 0,
        improvizedSolutions: 0,
      },
      fieldSurgeryUsedInRoom: [],
      npcAllies: [],
      missionElapsedMinutes: 0,
      eventCooldowns: {},
    };

    const gameId = await createGame({
      stationId: stationId as Id<"stations">,
      characterClass: setup.selectedClass,
      difficulty: setup.selectedDifficulty,
      state: initialState,
    });

    console.log('[App] game created, gameId:', gameId, '→ navigating to gameplay');
    nav.goToGameplay(gameId, stationId);
  }, [setup.selectedClass, setup.selectedDifficulty, createGame, nav]);

  return (
    <div className="h-full scanlines">
      {renderScreen()}
    </div>
  );

  function renderScreen() {
    const { screen } = nav;

    switch (screen.id) {
      case 'title':
        return (
          <TitleScreen
            onNewGame={nav.goToCharacterSelect}
            onHistory={nav.goToRunHistory}
          />
        );

      case 'character_select':
        return (
          <CharacterSelectScreen
            selectedClass={setup.selectedClass}
            selectedDifficulty={setup.selectedDifficulty}
            onSelectClass={setup.selectClass}
            onSelectDifficulty={setup.selectDifficulty}
            onConfirm={nav.goToStationPicker}
            onBack={nav.goToTitle}
          />
        );

      case 'station_picker':
        return (
          <StationPickerScreen
            onGenerate={() => { void handleGenerate(); }}
            onSelectStation={(stationId) => void handleStartGame(stationId)}
            onBack={nav.goToCharacterSelect}
          />
        );

      case 'loading':
        return (
          <LoadingScreen
            progressId={screen.progressId}
            onComplete={(stationId) => void handleStartGame(stationId)}
            onError={nav.goToStationPicker}
          />
        );

      case 'gameplay':
        return (
          <GameplayScreen
            gameId={screen.gameId}
            stationId={screen.stationId}
            onGameOver={nav.goToGameOver}
            onRunSummary={nav.goToRunSummary}
          />
        );

      case 'game_over':
        return (
          <GameOverScreen
            gameId={screen.gameId}
            onSummary={() => { nav.goToRunSummary(screen.gameId); }}
            onTitle={nav.goToTitle}
          />
        );

      case 'run_summary':
        return (
          <RunSummaryScreen
            gameId={screen.gameId}
            onTitle={nav.goToTitle}
            onHistory={nav.goToRunHistory}
          />
        );

      case 'run_history':
        return <RunHistoryScreen onBack={nav.goToTitle} />;
    }
  }
}
