/**
 * Client-side scoring — port of src/scoring.ts without Node.js fs dependency.
 * Scoring is computed on the client and saved to Convex via mutation.
 */

export interface RunMetrics {
  runId: string;
  characterClass: string;
  storyArc: string;
  difficulty: string;
  startTime: number;
  endTime: number | null;
  turnCount: number;
  missionElapsedMinutes: number;
  moveCount: number;
  totalDamageTaken: number;
  totalDamageHealed: number;
  roomsVisited: string[];
  itemsUsed: string[];
  itemsCollected: string[];
  crewLogsFound: number;
  creativeActionsAttempted: number;
  deathCause: string | null;
  won: boolean;
  endingId: string | null;
  systemsDiagnosed: number;
  systemsRepaired: number;
  systemsCascaded: number;
  itemsCrafted: number;
  improvizedSolutions: number;
}

export interface RunScore {
  speed: number;
  engineeringEfficiency: number;
  exploration: number;
  resourcefulness: number;
  completion: number;
  total: number;
  grade: ScoreGrade;
}

export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export function computeScore(metrics: RunMetrics, totalRooms: number): RunScore {
  // Speed scoring: based on in-game mission elapsed time (minutes)
  const parMinutes = metrics.won ? 180 : 90;
  const speed = Math.max(0, Math.min(100, 100 - Math.floor((metrics.missionElapsedMinutes - parMinutes) / 5) * 3));

  // Engineering efficiency
  const totalSystems = metrics.systemsDiagnosed + metrics.systemsRepaired;
  const cascadePenalty = metrics.systemsCascaded * 15;
  const improvBonus = metrics.improvizedSolutions * 10;
  const engineeringEfficiency = Math.max(0, Math.min(100,
    (totalSystems > 0 ? (metrics.systemsRepaired / Math.max(1, totalSystems)) * 60 : 0)
    + improvBonus - cascadePenalty + (metrics.itemsCrafted * 5),
  ));

  const uniqueRooms = new Set(metrics.roomsVisited).size;
  const exploration = Math.min(100, (uniqueRooms / totalRooms) * 100);

  const resourcefulness = Math.min(
    100,
    ((metrics.itemsCollected.length + metrics.itemsUsed.length + metrics.creativeActionsAttempted + metrics.itemsCrafted) / 15) * 100,
  );

  const completion = Math.min(
    100,
    (metrics.won ? 50 : 0) + metrics.systemsRepaired * 8 + Math.min(metrics.crewLogsFound * 2, 10),
  );

  const total = speed + engineeringEfficiency + exploration + resourcefulness + completion;
  const grade = computeGrade(total);

  return { speed, engineeringEfficiency, exploration, resourcefulness, completion, total, grade };
}

export function computeGrade(total: number): ScoreGrade {
  if (total >= 450) return 'S';
  if (total >= 375) return 'A';
  if (total >= 300) return 'B';
  if (total >= 200) return 'C';
  if (total >= 100) return 'D';
  return 'F';
}
