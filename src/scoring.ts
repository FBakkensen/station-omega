import { readFileSync, writeFileSync } from 'node:fs';
import type { RunMetrics, RunScore, ScoreGrade, RunHistoryEntry } from './types.js';

const HISTORY_PATH = 'run-history.json';
const MAX_HISTORY = 50;

export function computeScore(metrics: RunMetrics, totalRooms: number): RunScore {
    const parTurns = metrics.won ? 30 : 15;
    const speed = Math.max(0, Math.min(100, 100 - (metrics.turnCount - parTurns) * 3));

    // Engineering efficiency: systems diagnosed + repaired, minimal cascades, improvised solutions
    const totalSystems = metrics.systemsDiagnosed + metrics.systemsRepaired;
    const cascadePenalty = metrics.systemsCascaded * 15;
    const improvBonus = metrics.improvizedSolutions * 10;
    const engineeringEfficiency = Math.max(0, Math.min(100,
        (totalSystems > 0 ? (metrics.systemsRepaired / Math.max(1, totalSystems)) * 60 : 0)
        + improvBonus - cascadePenalty + (metrics.itemsCrafted * 5),
    ));

    const exploration = Math.min(100, (metrics.roomsVisited.size / totalRooms) * 100);

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

export function saveRunToHistory(metrics: RunMetrics, score: RunScore): void {
    const history = loadRunHistory();

    const entry: RunHistoryEntry = {
        runId: metrics.runId,
        characterClass: metrics.characterClass,
        storyArc: metrics.storyArc,
        difficulty: metrics.difficulty,
        won: metrics.won,
        endingId: metrics.endingId,
        score,
        turnCount: metrics.turnCount,
        duration: (metrics.endTime ?? metrics.startTime) - metrics.startTime,
        date: new Date().toISOString(),
    };

    history.push(entry);

    if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
    }

    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export function loadRunHistory(): RunHistoryEntry[] {
    try {
        const data = readFileSync(HISTORY_PATH, 'utf-8');
        return JSON.parse(data) as RunHistoryEntry[];
    } catch {
        return [];
    }
}

export function formatScoreBar(value: number, max: number): string {
    const barWidth = 20;
    const filled = Math.round((Math.min(value, max) / max) * barWidth);
    const empty = barWidth - filled;
    return '[' + '#'.repeat(filled) + '-'.repeat(empty) + '] ' + String(Math.round(value)) + '/' + String(max);
}
