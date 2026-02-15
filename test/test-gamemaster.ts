/**
 * Game Master model test: Tests each model's ability to handle
 * tool calling, structured narrative output, and instruction following.
 *
 * Run: bun test/test-gamemaster.ts [--runs=3] [--models=all|opus,flash] [--scenarios=all|opening]
 */

import { streamText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateSkeleton } from '../src/skeleton.js';
import { generateCreativeContent } from '../src/creative.js';
import { assembleStation } from '../src/assembly.js';
import { initializePlayerState, getBuild } from '../src/character.js';
import { createGameToolSets } from '../src/tools.js';
import type { GameContext, ChoiceSet } from '../src/tools.js';
import { buildOrchestratorPrompt } from '../src/prompt.js';
import { GameResponseSchema } from '../src/schema.js';
import type { GameResponse } from '../src/schema.js';
import { buildTurnContext } from '../src/turn-context.js';
import { validateGameResponse } from '../src/validation.js';
import type { GeneratedStation, Room, NPC, ObjectiveChain } from '../src/types.js';
import {
    type TestModel,
    createTestOpenRouter,
    getProviderOptions,
    ensureOutputDir,
    ensureFixturesDir,
    writeResult,
    sanitizeLabel,
    parseArgs,
} from './model-config.js';

// ─── JSON Extraction ────────────────────────────────────────────────────────

/** Extract JSON object from raw text that may include markdown fences or preamble. */
function extractJson(raw: string): string {
    // Try raw first
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) return trimmed;

    // Strip markdown code fences
    const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/u.exec(raw);
    if (fenceMatch) return fenceMatch[1].trim();

    // Find first { and last }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return raw.slice(firstBrace, lastBrace + 1);
    }

    return raw;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolCallRecord {
    name: string;
    input: unknown;
    output: unknown;
}

interface GMTestResult {
    model: string;
    scenario: string;
    run: number;
    raw: string;
    toolCalls: ToolCallRecord[];
    parsed: GameResponse | null;
    valid: boolean;
    guardrailIssues: string[];
    segmentTypes: string[];
    segmentTexts: string[];
    timing: { startMs: number; endMs: number; durationMs: number };
    error: string | null;
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

interface Scenario {
    id: string;
    label: string;
    prompt: string;
    expectedTools: string[];
}

const SCENARIOS: Scenario[] = [
    {
        id: 'opening',
        label: 'Opening Turn',
        prompt: 'I look around',
        expectedTools: ['look_around'],
    },
    {
        id: 'movement',
        label: 'Movement',
        prompt: 'I head to the nearest exit',
        expectedTools: ['move_to'],
    },
    {
        id: 'complex',
        label: 'Complex Action',
        prompt: 'I examine the nearest terminal and check for any crew logs',
        expectedTools: ['look_around'],
    },
];

// ─── Station Loading ────────────────────────────────────────────────────────

interface FixtureStation {
    rooms: Record<string, Room>;
    npcs: Record<string, NPC>;
    items: Record<string, unknown>;
    objectives: ObjectiveChain;
    [key: string]: unknown;
}

async function loadOrGenerateStation(): Promise<GeneratedStation> {
    const fixturePath = join(ensureFixturesDir(), 'test-station.json');

    if (existsSync(fixturePath)) {
        console.log('Loading cached station from fixture...');
        const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { station: FixtureStation };
        const s = raw.station;

        // Reconstruct Maps from plain objects
        const rooms = new Map(Object.entries(s.rooms));
        const npcs = new Map(Object.entries(s.npcs));
        // NPC behaviors need to be Sets (serialized as arrays in JSON)
        for (const npc of npcs.values()) {
            if (Array.isArray(npc.behaviors)) {
                npc.behaviors = new Set(npc.behaviors as Iterable<NPC['behaviors'] extends Set<infer T> ? T : never>);
            }
        }
        const items = new Map(Object.entries(s.items));

        // Reconstruct MapLayout positions
        const mapLayoutRaw = s['mapLayout'] as Record<string, unknown> | undefined;
        const mapLayout = {
            seed: (mapLayoutRaw?.['seed'] ?? 42) as number,
            positions: new Map(Object.entries((mapLayoutRaw?.['positions'] ?? {}) as Record<string, { x: number; y: number }>)),
            bounds: (mapLayoutRaw?.['bounds'] ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 }) as { minX: number; maxX: number; minY: number; maxY: number },
            scaleHint: (mapLayoutRaw?.['scaleHint'] ?? { dx: 1, dy: 1 }) as { dx: number; dy: number },
        };

        return {
            config: s['config'] as GeneratedStation['config'],
            stationName: s['stationName'] as string,
            briefing: s['briefing'] as string,
            backstory: s['backstory'] as string,
            rooms,
            npcs,
            items: items as Map<string, GeneratedStation['items'] extends Map<string, infer V> ? V : never>,
            objectives: s.objectives,
            entryRoomId: s['entryRoomId'] as string,
            escapeRoomId: s['escapeRoomId'] as string,
            crewRoster: s['crewRoster'] as GeneratedStation['crewRoster'],
            arrivalScenario: s['arrivalScenario'] as GeneratedStation['arrivalScenario'],
            mapLayout,
        };
    }

    console.log('No fixture found — generating station...');
    const skeleton = generateSkeleton({
        seed: 42,
        difficulty: 'normal',
        storyArc: 'cascade_failure',
        characterClass: 'engineer',
    });
    const creative = await generateCreativeContent(skeleton, (msg) => { console.log(`  ${msg}`); });
    return assembleStation(skeleton, creative);
}

// ─── Deep Copy Helpers ──────────────────────────────────────────────────────

function cloneStation(station: GeneratedStation): GeneratedStation {
    return {
        ...station,
        rooms: structuredClone(station.rooms),
        npcs: structuredClone(station.npcs),
        items: structuredClone(station.items),
        objectives: structuredClone(station.objectives),
    };
}

// ─── Test Runner ────────────────────────────────────────────────────────────

async function runGMTest(
    model: TestModel,
    scenario: Scenario,
    station: GeneratedStation,
    run: number,
): Promise<GMTestResult> {
    const openrouter = createTestOpenRouter();
    const startMs = Date.now();

    // Deep copy station for this run so tools don't mutate shared state
    const testStation = cloneStation(station);

    const build = getBuild('engineer');
    const state = initializePlayerState('engineer', testStation.entryRoomId, `test_${String(Date.now())}`, 'cascade_failure', 'normal');

    let pendingChoices: ChoiceSet | null = null;
    const gameCtx: GameContext = {
        state,
        station: testStation,
        build,
        onChoices: (cs) => { pendingChoices = cs; },
        turnElapsedMinutes: 0,
    };

    const toolSets = createGameToolSets('engineer', gameCtx);
    const systemPrompt = buildOrchestratorPrompt(testStation, build);
    const providerOptions = getProviderOptions(model);

    // Build messages — for opening, just the prompt
    // For movement/complex, run a simulated opening turn first
    const conversationHistory: ModelMessage[] = [];

    if (scenario.id !== 'opening') {
        // Simulate opening context: the model should already know the room
        const turnContext = buildTurnContext(state, testStation);
        if (turnContext) {
            conversationHistory.push({ role: 'system' as const, content: turnContext });
        }
        conversationHistory.push({ role: 'user' as const, content: 'I look around' });
        // Fake an assistant response so the model has context
        conversationHistory.push({
            role: 'assistant' as const,
            content: JSON.stringify({
                segments: [{ type: 'narration', text: 'I scan the room, taking in the flickering lights and the hum of failing systems.', npcId: null, crewName: null }],
            }),
        });
    }

    const turnContext = buildTurnContext(state, testStation);
    const messages: ModelMessage[] = [
        ...conversationHistory,
        ...(turnContext ? [{ role: 'system' as const, content: turnContext }] : []),
        { role: 'user' as const, content: scenario.prompt },
    ];

    try {
        const abort = new AbortController();
        const timeout = setTimeout(() => { abort.abort(); }, 120_000);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: openrouter(model.id),
            system: systemPrompt,
            messages,
            tools: toolSets.all,
            temperature: 0.8,
            maxOutputTokens: 8192,
            stopWhen: stepCountIs(12),
            abortSignal: abort.signal,
        };

        if (providerOptions) {
            streamOptions.providerOptions = providerOptions;
        }

        const result = streamText(streamOptions);

        let rawJson = '';
        const toolCalls: ToolCallRecord[] = [];

        for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
                rawJson += part.text;
            } else if (part.type === 'tool-call') {
                toolCalls.push({
                    name: part.toolName,
                    input: part.input,
                    output: null,
                });
            } else if (part.type === 'tool-result') {
                // Update the last matching tool call with its result
                const lastCall = [...toolCalls].reverse().find(tc => tc.name === part.toolName);
                if (lastCall) {
                    lastCall.output = part.output;
                }
            }
        }

        clearTimeout(timeout);

        const endMs = Date.now();

        // Parse and validate
        let parsed: GameResponse | null = null;
        let valid = false;
        let guardrailIssues: string[] = [];

        if (rawJson) {
            const cleanJson = extractJson(rawJson);
            try {
                parsed = GameResponseSchema.parse(JSON.parse(cleanJson));
                valid = true;
                guardrailIssues = validateGameResponse(parsed, state, testStation);
            } catch {
                // Try to parse as raw JSON without schema validation
                try {
                    const rawParsed = JSON.parse(cleanJson) as unknown;
                    if (rawParsed && typeof rawParsed === 'object' && 'segments' in rawParsed) {
                        parsed = rawParsed as GameResponse;
                    }
                } catch {
                    // Not parseable at all
                }
            }
        }

        const segmentTypes = parsed?.segments.map(s => s.type) ?? [];
        const segmentTexts = parsed?.segments.map(s => s.text.slice(0, 200)) ?? [];

        // Suppress unused variable warning
        void pendingChoices;

        return {
            model: model.id,
            scenario: scenario.id,
            run,
            raw: rawJson,
            toolCalls,
            parsed,
            valid,
            guardrailIssues,
            segmentTypes,
            segmentTexts,
            timing: { startMs, endMs, durationMs: endMs - startMs },
            error: null,
        };
    } catch (err: unknown) {
        const endMs = Date.now();
        void pendingChoices;
        return {
            model: model.id,
            scenario: scenario.id,
            run,
            raw: '',
            toolCalls: [],
            parsed: null,
            valid: false,
            guardrailIssues: [],
            segmentTypes: [],
            segmentTexts: [],
            timing: { startMs, endMs, durationMs: endMs - startMs },
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const validScenarioIds = SCENARIOS.map(s => s.id);
    const { runs, models, scenarios: scenarioFilter } = parseArgs(validScenarioIds);

    const activeScenarios = scenarioFilter.length > 0
        ? SCENARIOS.filter(s => scenarioFilter.includes(s.id))
        : SCENARIOS;

    console.log(`Game Master Model Test — ${String(models.length)} models × ${String(activeScenarios.length)} scenarios × ${String(runs)} runs`);
    console.log(`Models: ${models.map(m => m.label).join(', ')}`);
    console.log(`Scenarios: ${activeScenarios.map(s => s.label).join(', ')}\n`);

    const station = await loadOrGenerateStation();
    console.log(`Station: ${station.stationName} (${String(station.rooms.size)} rooms)\n`);

    for (const model of models) {
        const modelDir = sanitizeLabel(model.label);

        console.log(`── ${model.label} (${model.id}) ──`);

        for (const scenario of activeScenarios) {
            console.log(`  Scenario: ${scenario.label}`);

            for (let run = 1; run <= runs; run++) {
                process.stdout.write(`    Run ${String(run)}/${String(runs)}...`);

                const result = await runGMTest(model, scenario, station, run);

                const toolNames = result.toolCalls.map(tc => tc.name).join(', ') || 'none';
                const expectedHit = scenario.expectedTools.some(et =>
                    result.toolCalls.some(tc => tc.name === et)
                );

                const status = result.valid
                    ? `PASS (tools: ${toolNames}${expectedHit ? '' : ' ⚠ expected: ' + scenario.expectedTools.join(',')})`
                    : `FAIL${result.error ? `: ${result.error.slice(0, 80)}` : ''}`;

                console.log(` ${status} [${String(Math.round(result.timing.durationMs / 1000))}s]`);

                if (result.guardrailIssues.length > 0) {
                    console.log(`      Guardrail issues: ${result.guardrailIssues.join('; ')}`);
                }

                // Save result
                const dir = ensureOutputDir(join('gamemaster', modelDir, `scenario-${scenario.id}`));
                writeResult(join(dir, `run-${String(run)}.json`), result);
            }
        }

        console.log('');
    }

    console.log('Done. Results in test/results/gamemaster/');
}

main().catch((err: unknown) => {
    console.error('Game Master test failed:', err);
    process.exit(1);
});
