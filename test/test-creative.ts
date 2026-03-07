/**
 * Creative model test: Tests each model's ability to produce valid
 * CreativeOutputSchema JSON for station generation.
 *
 * Run: bun test/test-creative.ts [--runs=3] [--models=all|opus,flash]
 */

import { streamText, Output } from 'ai';
import { join } from 'node:path';
import { generateStation } from '../src/generation/index.js';
import { GENERATION_MODEL_ID, getDefaultAITextClient } from '../src/models.js';
import { CreativeLayerSchema } from '../src/generation/layers/creative.js';
import type { StationSkeleton } from '../src/types.js';
import {
    type TestModel,
    createTestOpenRouter,
    ensureOutputDir,
    writeResult,
    sanitizeLabel,
    parseArgs,
} from './model-config.js';

const CreativeOutputSchema = CreativeLayerSchema;

const CREATIVE_PROMPT = `You generate creative content for a grounded sci-fi engineering survival game.

Rules:
- Every roomId/itemId in output must match IDs from station data.
- Generate practical room names, concise engineering descriptions, and crew logs.
- Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis.
- Include arrivalScenario and startingItem that fit the character class and starting room.
- Return valid JSON only.`;

function buildSkeletonSummary(skeleton: StationSkeleton): string {
    const roomSummaries = skeleton.rooms.map(r => ({
        id: r.id,
        archetype: r.archetype,
        depth: r.depth,
        hasLoot: r.lootSlots.length > 0,
        lootCategories: r.lootSlots.map(s => s.category),
        isObjective: r.isObjectiveRoom,
        systemFailures: r.systemFailures.map(f => ({ system: f.systemId, mode: f.failureMode, severity: f.severity })),
    }));

    const itemSummaries = skeleton.items.map(i => ({
        id: i.id,
        category: i.category,
        effectType: i.effect.type,
    }));

    return JSON.stringify({
        characterClass: skeleton.config.characterClass,
        startingRoomArchetype: skeleton.rooms[0].archetype,
        storyArc: skeleton.config.storyArc,
        difficulty: skeleton.config.difficulty,
        objectiveTitle: skeleton.objectives.title,
        objectiveSteps: skeleton.objectives.steps.map(s => s.description),
        rooms: roomSummaries,
        items: itemSummaries,
    }, null, 2);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface CreativeTestResult {
    model: string;
    run: number;
    raw: string;
    parsed: unknown;
    valid: boolean;
    roomIdMatch: number;
    roomIdTotal: number;
    itemIdMatch: number;
    itemIdTotal: number;
    crewCount: number;
    timing: { startMs: number; endMs: number; durationMs: number };
    error: string | null;
}

// ─── Test Runner ────────────────────────────────────────────────────────────

async function runCreativeTest(
    model: TestModel,
    skeleton: StationSkeleton,
    skeletonSummary: string,
    run: number,
): Promise<CreativeTestResult> {
    const openrouter = createTestOpenRouter();
    const startMs = Date.now();

    const userPrompt = `Generate creative content for this station skeleton:

<station_skeleton>
${skeletonSummary}
</station_skeleton>

Briefing: 1-2 sentences. Backstory: 2-3 sentences. Room descriptions: 2-3 sentences each focusing on engineering state. engineeringNotes: 1-2 sentences of technical readings. Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis. arrivalScenario: connect the character class to the starting room archetype. startingItem: appropriate for the scenario and starting room (medical heal 15-40, tool/material effectValue 1).`;

    try {
        const abort = new AbortController();
        const timeout = setTimeout(() => { abort.abort(); }, 300_000);

        // For models without structured output support, append JSON instruction
        const systemPrompt = model.supportsStructured
            ? CREATIVE_PROMPT
            : CREATIVE_PROMPT + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation — just the JSON object.';

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: openrouter(model.id),
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 1.0,
            maxOutputTokens: 16384,
            abortSignal: abort.signal,
        };

        // Only use Output.object for models that support structured output
        if (model.supportsStructured) {
            streamOptions.output = Output.object({ schema: CreativeOutputSchema });
        }

        const result = streamText(streamOptions);

        let rawText = '';
        for await (const delta of result.textStream) {
            rawText += delta;
        }
        clearTimeout(timeout);

        const endMs = Date.now();

        // Try to parse — either from SDK structured output or raw JSON
        let parsed: unknown = null;
        let valid = false;
        let roomIdMatch = 0;
        let itemIdMatch = 0;

        try {
            if (model.supportsStructured) {
                parsed = await result.output;
            }
            if (!parsed) {
                parsed = JSON.parse(rawText);
            }

            // Validate against schema
            CreativeOutputSchema.parse(parsed);
            valid = true;
        } catch {
            // Schema validation failed, try raw JSON parse for partial analysis
            if (!parsed) {
                try {
                    parsed = JSON.parse(rawText);
                } catch {
                    // Can't parse at all
                }
            }
        }

        // ID matching analysis
        const skeletonRoomIds = new Set(skeleton.rooms.map(r => r.id));
        const skeletonItemIds = new Set(skeleton.items.map(i => i.id));

        if (parsed && typeof parsed === 'object') {
            const p = parsed as Record<string, unknown>;
            if (Array.isArray(p['rooms'])) {
                for (const room of p['rooms'] as Array<Record<string, unknown>>) {
                    if (typeof room['roomId'] === 'string' && skeletonRoomIds.has(room['roomId'])) {
                        roomIdMatch++;
                    }
                }
            }
            if (Array.isArray(p['items'])) {
                for (const item of p['items'] as Array<Record<string, unknown>>) {
                    if (typeof item['itemId'] === 'string' && skeletonItemIds.has(item['itemId'])) {
                        itemIdMatch++;
                    }
                }
            }
        }

        const crewCount = parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['crewRoster'])
            ? ((parsed as Record<string, unknown>)['crewRoster'] as unknown[]).length
            : 0;

        return {
            model: model.id,
            run,
            raw: rawText,
            parsed,
            valid,
            roomIdMatch,
            roomIdTotal: skeletonRoomIds.size,
            itemIdMatch,
            itemIdTotal: skeletonItemIds.size,
            crewCount,
            timing: { startMs, endMs, durationMs: endMs - startMs },
            error: null,
        };
    } catch (err: unknown) {
        const endMs = Date.now();
        return {
            model: model.id,
            run,
            raw: '',
            parsed: null,
            valid: false,
            roomIdMatch: 0,
            roomIdTotal: skeleton.rooms.length,
            itemIdMatch: 0,
            itemIdTotal: skeleton.items.length,
            crewCount: 0,
            timing: { startMs, endMs, durationMs: endMs - startMs },
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const { runs, models } = parseArgs();

    console.log(`Creative Model Test — ${String(models.length)} models × ${String(runs)} runs`);
    console.log(`Models: ${models.map(m => m.label).join(', ')}\n`);

    // Generate skeleton via AI-driven pipeline
    console.log('Generating station skeleton...');
    const { skeleton } = await generateStation(
        {
            difficulty: 'normal',
            characterClass: 'engineer',
            aiClient: getDefaultAITextClient(),
            modelId: GENERATION_MODEL_ID,
        },
        (msg) => { console.log(`  ${msg}`); },
    );
    const skeletonSummary = buildSkeletonSummary(skeleton);

    console.log(`Skeleton: ${String(skeleton.rooms.length)} rooms, ${String(skeleton.items.length)} items\n`);

    for (const model of models) {
        const modelDir = sanitizeLabel(model.label);

        console.log(`── ${model.label} (${model.id}) ──`);
        if (!model.supportsStructured) {
            console.log('  ⚠ No structured output — using prompt-only JSON');
        }

        for (let run = 1; run <= runs; run++) {
            process.stdout.write(`  Run ${String(run)}/${String(runs)}...`);

            const result = await runCreativeTest(model, skeleton, skeletonSummary, run);

            const status = result.valid
                ? `PASS (rooms: ${String(result.roomIdMatch)}/${String(result.roomIdTotal)}, items: ${String(result.itemIdMatch)}/${String(result.itemIdTotal)}, crew: ${String(result.crewCount)})`
                : `FAIL${result.error ? `: ${result.error.slice(0, 80)}` : ''}`;

            console.log(` ${status} [${String(Math.round(result.timing.durationMs / 1000))}s]`);

            // Save result
            const dir = ensureOutputDir(join('creative', modelDir));
            writeResult(join(dir, `run-${String(run)}.json`), result);
        }

        console.log('');
    }

    console.log('Done. Results in test/results/creative/');
}

main().catch((err: unknown) => {
    console.error('Creative test failed:', err);
    process.exit(1);
});
