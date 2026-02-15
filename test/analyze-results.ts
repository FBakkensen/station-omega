/**
 * Results analyzer: Reads all test results and produces a markdown report.
 *
 * Run: bun test/analyze-results.ts
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_BASE = join(import.meta.dirname, '..', 'test', 'results');

// ─── Types ──────────────────────────────────────────────────────────────────

interface CreativeResult {
    model: string;
    run: number;
    valid: boolean;
    roomIdMatch: number;
    roomIdTotal: number;
    itemIdMatch: number;
    itemIdTotal: number;
    crewCount: number;
    timing: { durationMs: number };
    error: string | null;
    parsed?: { rooms?: Array<{ name?: string; descriptionSeed?: string }> };
}

interface GMResult {
    model: string;
    scenario: string;
    run: number;
    valid: boolean;
    toolCalls: Array<{ name: string }>;
    guardrailIssues: string[];
    segmentTypes: string[];
    segmentTexts: string[];
    timing: { durationMs: number };
    error: string | null;
}

// ─── Loader Helpers ─────────────────────────────────────────────────────────

function loadJsonFiles<T>(dir: string): T[] {
    if (!existsSync(dir)) return [];
    const results: T[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.json')) {
            try {
                results.push(JSON.parse(readFileSync(fullPath, 'utf-8')) as T);
            } catch {
                // Skip malformed files
            }
        } else if (entry.isDirectory()) {
            results.push(...loadJsonFiles<T>(fullPath));
        }
    }
    return results;
}

// ─── Analysis Functions ─────────────────────────────────────────────────────

function analyzeCreative(results: CreativeResult[]): string {
    if (results.length === 0) return '## Creative Test Results\n\nNo results found.\n';

    // Group by model
    const byModel = new Map<string, CreativeResult[]>();
    for (const r of results) {
        const existing = byModel.get(r.model) ?? [];
        existing.push(r);
        byModel.set(r.model, existing);
    }

    const lines: string[] = ['## Creative Test Results\n'];

    // Summary table
    lines.push('| Model | Pass Rate | Avg Room Match | Avg Item Match | Avg Crew | Avg Time |');
    lines.push('|---|---|---|---|---|---|');

    for (const [model, runs] of byModel) {
        const total = runs.length;
        const passed = runs.filter(r => r.valid).length;
        const passRate = `${String(passed)}/${String(total)} (${String(Math.round(passed / total * 100))}%)`;

        const avgRoomMatch = runs.reduce((s, r) => s + (r.roomIdTotal > 0 ? r.roomIdMatch / r.roomIdTotal : 0), 0) / total;
        const avgItemMatch = runs.reduce((s, r) => s + (r.itemIdTotal > 0 ? r.itemIdMatch / r.itemIdTotal : 0), 0) / total;
        const avgCrew = runs.reduce((s, r) => s + r.crewCount, 0) / total;
        const avgTime = runs.reduce((s, r) => s + r.timing.durationMs, 0) / total / 1000;

        const shortModel = model.split('/').pop() ?? model;
        lines.push(`| ${shortModel} | ${passRate} | ${(avgRoomMatch * 100).toFixed(0)}% | ${(avgItemMatch * 100).toFixed(0)}% | ${avgCrew.toFixed(1)} | ${avgTime.toFixed(1)}s |`);
    }

    lines.push('');

    // Error summary
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
        lines.push('### Errors\n');
        for (const e of errors) {
            const shortModel = e.model.split('/').pop() ?? e.model;
            lines.push(`- **${shortModel}** run ${String(e.run)}: ${e.error?.slice(0, 120) ?? 'unknown'}`);
        }
        lines.push('');
    }

    // Sample descriptions (first room from first valid run per model)
    lines.push('### Sample Room Descriptions\n');
    for (const [model, runs] of byModel) {
        const validRun = runs.find(r => r.valid && r.parsed);
        if (!validRun?.parsed) continue;

        const rooms = validRun.parsed.rooms;
        const firstRoom = Array.isArray(rooms) ? rooms[0] : undefined;
        if (!firstRoom) continue;

        const shortModel = model.split('/').pop() ?? model;
        const name = firstRoom.name ?? 'unnamed';
        const desc = firstRoom.descriptionSeed?.slice(0, 200) ?? 'no description';
        lines.push(`**${shortModel}**: *${name}* — ${desc}\n`);
    }

    return lines.join('\n');
}

function analyzeGameMaster(results: GMResult[]): string {
    if (results.length === 0) return '## Game Master Test Results\n\nNo results found.\n';

    // Group by model
    const byModel = new Map<string, GMResult[]>();
    for (const r of results) {
        const existing = byModel.get(r.model) ?? [];
        existing.push(r);
        byModel.set(r.model, existing);
    }

    const lines: string[] = ['## Game Master Test Results\n'];

    // Summary table per scenario
    const scenarios = [...new Set(results.map(r => r.scenario))];

    for (const scenario of scenarios) {
        lines.push(`### Scenario: ${scenario}\n`);
        lines.push('| Model | Pass Rate | Avg Tools | Guardrail Issues | Avg Time |');
        lines.push('|---|---|---|---|---|');

        for (const [model, runs] of byModel) {
            const scenarioRuns = runs.filter(r => r.scenario === scenario);
            if (scenarioRuns.length === 0) continue;

            const total = scenarioRuns.length;
            const passed = scenarioRuns.filter(r => r.valid).length;
            const passRate = `${String(passed)}/${String(total)} (${String(Math.round(passed / total * 100))}%)`;

            const avgTools = scenarioRuns.reduce((s, r) => s + r.toolCalls.length, 0) / total;
            const guardrailCount = scenarioRuns.reduce((s, r) => s + r.guardrailIssues.length, 0);
            const avgTime = scenarioRuns.reduce((s, r) => s + r.timing.durationMs, 0) / total / 1000;

            const shortModel = model.split('/').pop() ?? model;
            lines.push(`| ${shortModel} | ${passRate} | ${avgTools.toFixed(1)} | ${String(guardrailCount)} | ${avgTime.toFixed(1)}s |`);
        }

        lines.push('');
    }

    // Tool calling accuracy
    lines.push('### Tool Calling Patterns\n');
    lines.push('| Model | Scenario | Tools Called |');
    lines.push('|---|---|---|');

    for (const [model, runs] of byModel) {
        for (const scenario of scenarios) {
            const scenarioRuns = runs.filter(r => r.scenario === scenario);
            const allTools = scenarioRuns.flatMap(r => r.toolCalls.map(tc => tc.name));
            const toolCounts = new Map<string, number>();
            for (const t of allTools) {
                toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
            }
            const toolSummary = [...toolCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `${name}(${String(count)})`)
                .join(', ') || 'none';

            const shortModel = model.split('/').pop() ?? model;
            lines.push(`| ${shortModel} | ${scenario} | ${toolSummary} |`);
        }
    }

    lines.push('');

    // Segment type distribution
    lines.push('### Segment Type Distribution\n');
    lines.push('| Model | narration | dialogue | thought | station_pa | crew_echo | diagnostic |');
    lines.push('|---|---|---|---|---|---|---|');

    for (const [model, runs] of byModel) {
        const allTypes = runs.flatMap(r => r.segmentTypes);
        const typeCounts: Record<string, number> = {};
        for (const t of allTypes) {
            typeCounts[t] = (typeCounts[t] ?? 0) + 1;
        }

        const shortModel = model.split('/').pop() ?? model;
        lines.push(`| ${shortModel} | ${String(typeCounts['narration'] ?? 0)} | ${String(typeCounts['dialogue'] ?? 0)} | ${String(typeCounts['thought'] ?? 0)} | ${String(typeCounts['station_pa'] ?? 0)} | ${String(typeCounts['crew_echo'] ?? 0)} | ${String(typeCounts['diagnostic_readout'] ?? 0)} |`);
    }

    lines.push('');

    // Guardrail violations
    const allGuardrails = results.flatMap(r => r.guardrailIssues);
    if (allGuardrails.length > 0) {
        lines.push('### Guardrail Violations\n');
        const issueCounts = new Map<string, number>();
        for (const issue of allGuardrails) {
            issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
        }
        for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`- ${issue} (${String(count)}×)`);
        }
        lines.push('');
    }

    // Sample narratives
    lines.push('### Sample Narrative Excerpts\n');
    for (const [model, runs] of byModel) {
        const validRun = runs.find(r => r.valid && r.segmentTexts.length > 0);
        if (!validRun) continue;

        const shortModel = model.split('/').pop() ?? model;
        const firstSegment = validRun.segmentTexts[0]?.slice(0, 200) ?? '';
        lines.push(`**${shortModel}** (${validRun.scenario}): ${firstSegment}\n`);
    }

    // Error summary
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
        lines.push('### Errors\n');
        for (const e of errors) {
            const shortModel = e.model.split('/').pop() ?? e.model;
            lines.push(`- **${shortModel}** ${e.scenario} run ${String(e.run)}: ${e.error?.slice(0, 120) ?? 'unknown'}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    console.log('Analyzing test results...\n');

    const creativeDir = join(RESULTS_BASE, 'creative');
    const gmDir = join(RESULTS_BASE, 'gamemaster');

    const creativeResults = loadJsonFiles<CreativeResult>(creativeDir);
    const gmResults = loadJsonFiles<GMResult>(gmDir);

    console.log(`Found ${String(creativeResults.length)} creative results, ${String(gmResults.length)} GM results`);

    const creativeReport = analyzeCreative(creativeResults);
    const gmReport = analyzeGameMaster(gmResults);

    const report = `# Station Omega — Model Test Report

Generated: ${new Date().toISOString()}

${creativeReport}

---

${gmReport}
`;

    const reportPath = join(RESULTS_BASE, 'report.md');
    writeFileSync(reportPath, report);
    console.log(`\nReport written to ${reportPath}`);

    // Save timestamped snapshot to test/reports/ (tracked in git)
    const historyDir = join(import.meta.dirname, '..', 'test', 'reports');
    mkdirSync(historyDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const models = [...new Set([
        ...creativeResults.map(r => (r.model.split('/').pop() ?? r.model)),
        ...gmResults.map(r => (r.model.split('/').pop() ?? r.model)),
    ])].sort();
    const historyPath = join(historyDir, `${timestamp}_${String(models.length)}-models.md`);
    writeFileSync(historyPath, report);
    console.log(`History snapshot saved to ${historyPath}`);

    // Also print to stdout
    console.log('\n' + report);
}

main();
