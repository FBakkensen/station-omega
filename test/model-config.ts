import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ─── Model Registry ─────────────────────────────────────────────────────────

export interface TestModel {
    id: string;           // OpenRouter model ID
    label: string;        // Human-friendly name
    supportsStructured: boolean;  // Has response_format/structured_outputs
    isAnthropic: boolean; // Needs anthropicDirect provider options
}

export const TEST_MODELS: TestModel[] = [
    { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', supportsStructured: true, isAnthropic: true },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', supportsStructured: true, isAnthropic: true },
    { id: 'google/gemini-3-pro-preview', label: 'Gemini 3.0 Pro', supportsStructured: true, isAnthropic: false },
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3.0 Flash', supportsStructured: true, isAnthropic: false },
    { id: 'moonshotai/kimi-k2', label: 'Kimi K2', supportsStructured: true, isAnthropic: false },
    { id: 'minimax/minimax-m2.5', label: 'MiniMax M2.5', supportsStructured: true, isAnthropic: false },
    { id: 'z-ai/glm-5', label: 'GLM 5', supportsStructured: true, isAnthropic: false },
    { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', supportsStructured: true, isAnthropic: false },
    { id: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast', supportsStructured: true, isAnthropic: false },
    { id: 'stepfun/step-3.5-flash', label: 'Step 3.5 Flash', supportsStructured: false, isAnthropic: false },
];

// ─── Provider Utilities ─────────────────────────────────────────────────────

export function createTestOpenRouter() {
    return createOpenRouter({
        apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
        headers: {
            'HTTP-Referer': 'https://github.com/station-omega',
            'X-Title': 'Station Omega Model Tests',
        },
    });
}

/** Anthropic-direct provider options, matching models.ts anthropicDirect. */
const anthropicDirectOptions = {
    openrouter: {
        provider: {
            order: ['anthropic'],
            allow_fallbacks: false,
        },
    },
};

/** Returns anthropicDirect provider options for Anthropic models, undefined otherwise. */
export function getProviderOptions(model: TestModel): typeof anthropicDirectOptions | undefined {
    if (model.isAnthropic) {
        return anthropicDirectOptions;
    }
    return undefined;
}

// ─── File Utilities ─────────────────────────────────────────────────────────

const RESULTS_BASE = join(import.meta.dirname, '..', 'test', 'results');
const FIXTURES_BASE = join(import.meta.dirname, '..', 'test', 'fixtures');

export function ensureOutputDir(subdir: string): string {
    const dir = join(RESULTS_BASE, subdir);
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function ensureFixturesDir(): string {
    mkdirSync(FIXTURES_BASE, { recursive: true });
    return FIXTURES_BASE;
}

export function writeResult(filePath: string, data: unknown): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function sanitizeLabel(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '');
}

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

export interface TestArgs {
    runs: number;
    models: TestModel[];
    scenarios: string[];
}

export function parseArgs(validScenarios?: string[]): TestArgs {
    const args = process.argv.slice(2);
    let runs = 3;
    let modelFilter = 'all';
    let scenarioFilter = 'all';

    for (const arg of args) {
        if (arg.startsWith('--runs=')) {
            runs = parseInt(arg.slice(7), 10);
            if (isNaN(runs) || runs < 1) runs = 3;
        } else if (arg.startsWith('--models=')) {
            modelFilter = arg.slice(9);
        } else if (arg.startsWith('--scenarios=')) {
            scenarioFilter = arg.slice(12);
        }
    }

    let models: TestModel[];
    if (modelFilter === 'all') {
        models = [...TEST_MODELS];
    } else {
        const requested = modelFilter.split(',').map(s => s.trim().toLowerCase());
        models = TEST_MODELS.filter(m => {
            const labelLower = m.label.toLowerCase();
            return requested.some(r => labelLower.includes(r) || m.id.includes(r));
        });
        if (models.length === 0) {
            console.error(`No models matched filter: ${modelFilter}`);
            console.error(`Available: ${TEST_MODELS.map(m => m.label).join(', ')}`);
            process.exit(1);
        }
    }

    let scenarios: string[];
    if (scenarioFilter === 'all' || !validScenarios) {
        scenarios = validScenarios ?? [];
    } else {
        scenarios = scenarioFilter.split(',').map(s => s.trim());
    }

    return { runs, models, scenarios };
}
