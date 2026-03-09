import { useState, useCallback } from 'react';

export type CharacterClassId = 'engineer' | 'scientist' | 'medic' | 'commander';
export type Difficulty = 'normal' | 'hard' | 'nightmare';

interface GameSetup {
  selectedClass: CharacterClassId | null;
  selectedDifficulty: Difficulty;
  selectClass: (classId: CharacterClassId) => void;
  selectDifficulty: (difficulty: Difficulty) => void;
}

export function useGameSetup(): GameSetup {
  const [selectedClass, setSelectedClass] = useState<CharacterClassId | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('normal');

  return {
    selectedClass,
    selectedDifficulty,
    selectClass: useCallback((classId: CharacterClassId) => { setSelectedClass(classId); }, []),
    selectDifficulty: useCallback((difficulty: Difficulty) => { setSelectedDifficulty(difficulty); }, []),
  };
}
