/**
 * Generate and cache a test station fixture for Game Master tests.
 *
 * Run: bun test/generate-fixture.ts
 *
 * Produces test/fixtures/test-station.json containing the skeleton,
 * creative content, and assembled station (serialized from Maps to plain objects).
 */

import { join } from 'node:path';
import { generateStation } from '../src/generation/index.js';
import { GENERATION_MODEL_TIERS, getDefaultAITextClient } from '../src/models.js';
import { assembleStation } from '../src/assembly.js';
import { ensureFixturesDir, writeResult } from './model-config.js';
import type { GeneratedStation } from '../src/types.js';

// ─── Serialization Helpers ──────────────────────────────────────────────────

function serializeStation(station: GeneratedStation): Record<string, unknown> {
    return {
        config: station.config,
        stationName: station.stationName,
        briefing: station.briefing,
        backstory: station.backstory,
        rooms: Object.fromEntries(station.rooms),
        items: Object.fromEntries(station.items),
        objectives: station.objectives,
        entryRoomId: station.entryRoomId,
        escapeRoomId: station.escapeRoomId,
        crewRoster: station.crewRoster,
        arrivalScenario: station.arrivalScenario,
        mapLayout: {
            seed: station.mapLayout.seed,
            positions: Object.fromEntries(station.mapLayout.positions),
            bounds: station.mapLayout.bounds,
            scaleHint: station.mapLayout.scaleHint,
        },
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('Generating test fixture (AI-driven, engineer, normal)...');

    const { skeleton, creative } = await generateStation(
        {
            difficulty: 'normal',
            characterClass: 'engineer',
            aiClient: getDefaultAITextClient(),
            modelTiers: GENERATION_MODEL_TIERS,
        },
        (msg) => { console.log(`  ${msg}`); },
    );

    console.log(`Skeleton: ${String(skeleton.rooms.length)} rooms, ${String(skeleton.items.length)} items`);
    console.log(`Creative: ${creative.stationName}, ${String(creative.crewRoster.length)} crew`);

    const station = assembleStation(skeleton, creative);
    console.log(`Assembled: ${String(station.rooms.size)} rooms, ${String(station.items.size)} items`);

    // Serialize
    const fixturesDir = ensureFixturesDir();
    const outPath = join(fixturesDir, 'test-station.json');

    const fixture = {
        generatedAt: new Date().toISOString(),
        skeleton,
        creative,
        station: serializeStation(station),
    };

    writeResult(outPath, fixture);
    console.log(`Fixture saved to ${outPath}`);
}

main().catch((err: unknown) => {
    console.error('Fixture generation failed:', err);
    process.exit(1);
});
