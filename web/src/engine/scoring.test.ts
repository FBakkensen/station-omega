import { describe, expect, it } from 'vitest';
import { computeGrade, computeScore, type RunMetrics } from './scoring';

const baseMetrics: RunMetrics = {
  runId: 'run_scoring',
  characterClass: 'engineer',
  storyArc: 'cascade_failure',
  difficulty: 'normal',
  startTime: 0,
  endTime: null,
  turnCount: 10,
  missionElapsedMinutes: 180,
  moveCount: 5,
  totalDamageTaken: 8,
  totalDamageHealed: 4,
  roomsVisited: ['room_0', 'room_1', 'room_2', 'room_3'],
  itemsUsed: ['item_0'],
  itemsCollected: ['item_0', 'item_1'],
  crewLogsFound: 4,
  creativeActionsAttempted: 2,
  deathCause: null,
  won: true,
  endingId: null,
  systemsDiagnosed: 4,
  systemsRepaired: 3,
  systemsCascaded: 1,
  itemsCrafted: 1,
  improvizedSolutions: 2,
};

describe('scoring contracts', () => {
  it('[Z] assigns F for zero total score', () => {
    expect(computeGrade(0)).toBe('F');
  });

  it('[O] assigns S exactly at the top threshold boundary', () => {
    expect(computeGrade(450)).toBe('S');
  });

  it('[M] enforces the full grade threshold table', () => {
    const cases: Array<{ total: number; grade: ReturnType<typeof computeGrade> }> = [
      { total: 450, grade: 'S' },
      { total: 449.99, grade: 'A' },
      { total: 375, grade: 'A' },
      { total: 374.99, grade: 'B' },
      { total: 300, grade: 'B' },
      { total: 299.99, grade: 'C' },
      { total: 200, grade: 'C' },
      { total: 199.99, grade: 'D' },
      { total: 100, grade: 'D' },
      { total: 99.99, grade: 'F' },
    ];

    for (const testCase of cases) {
      expect(computeGrade(testCase.total)).toBe(testCase.grade);
    }
  });

  it('[B] keeps boundary behavior stable at 100/200/300/375/450', () => {
    expect(computeGrade(100)).toBe('D');
    expect(computeGrade(200)).toBe('C');
    expect(computeGrade(300)).toBe('B');
    expect(computeGrade(375)).toBe('A');
    expect(computeGrade(450)).toBe('S');
  });

  it('[I] computes exact component totals for a reference metrics fixture', () => {
    const score = computeScore(baseMetrics, 8);

    expect(score.speed).toBe(100);
    expect(score.engineeringEfficiency).toBeCloseTo(35.714285714285715, 12);
    expect(score.exploration).toBe(50);
    expect(score.resourcefulness).toBe(40);
    expect(score.completion).toBe(82);
    expect(score.total).toBeCloseTo(307.7142857142857, 12);
    expect(score.grade).toBe('B');
  });

  it('[E] keeps negative totals in the lowest grade', () => {
    expect(computeGrade(-5)).toBe('F');
  });

  it('[S] clamps computed score components to safe ranges', () => {
    const score = computeScore(
      {
        ...baseMetrics,
        missionElapsedMinutes: 9999,
        systemsDiagnosed: 0,
        systemsRepaired: 0,
        systemsCascaded: 999,
        improvizedSolutions: 0,
        itemsCrafted: 0,
        roomsVisited: ['room_0', 'room_1', 'room_2', 'room_3', 'room_4', 'room_5'],
        itemsCollected: Array.from({ length: 99 }, (_, i) => `item_${String(i)}`),
        itemsUsed: Array.from({ length: 99 }, (_, i) => `used_${String(i)}`),
        creativeActionsAttempted: 99,
      },
      3,
    );

    expect(score.speed).toBeGreaterThanOrEqual(0);
    expect(score.speed).toBeLessThanOrEqual(100);
    expect(score.engineeringEfficiency).toBeGreaterThanOrEqual(0);
    expect(score.engineeringEfficiency).toBeLessThanOrEqual(100);
    expect(score.exploration).toBeGreaterThanOrEqual(0);
    expect(score.exploration).toBeLessThanOrEqual(100);
    expect(score.resourcefulness).toBeGreaterThanOrEqual(0);
    expect(score.resourcefulness).toBeLessThanOrEqual(100);
    expect(score.completion).toBeGreaterThanOrEqual(0);
    expect(score.completion).toBeLessThanOrEqual(100);
  });
});
