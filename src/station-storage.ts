import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
    GeneratedStation,
    Difficulty,
    NPC,
    NPCBehaviorFlag,
    MapLayout,
} from './types.js';

// ─── Storage Types ──────────────────────────────────────────────────────────

/** Lightweight metadata for listing (no full station data). */
export interface SavedStationMeta {
    id: string;
    stationName: string;
    briefing: string;
    difficulty: Difficulty;
    savedAt: string;
}

/** Serialized form of GeneratedStation (Maps→Records, Sets→Arrays). */
interface SerializedStation {
    config: GeneratedStation['config'];
    stationName: string;
    briefing: string;
    backstory: string;
    rooms: Record<string, GeneratedStation['rooms'] extends Map<string, infer V> ? V : never>;
    npcs: Record<string, SerializedNPC>;
    items: Record<string, GeneratedStation['items'] extends Map<string, infer V> ? V : never>;
    objectives: GeneratedStation['objectives'];
    entryRoomId: string;
    escapeRoomId: string;
    crewRoster: GeneratedStation['crewRoster'];
    arrivalScenario: GeneratedStation['arrivalScenario'];
    mapLayout: SerializedMapLayout;
}

type SerializedNPC = Omit<NPC, 'behaviors'> & { behaviors: NPCBehaviorFlag[] };

interface SerializedMapLayout {
    seed: number;
    positions: Record<string, { x: number; y: number }>;
    bounds: MapLayout['bounds'];
    scaleHint: MapLayout['scaleHint'];
}

/** Full file contents (saved-stations/<id>.json). */
interface SavedStationFile extends SavedStationMeta {
    station: SerializedStation;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_DIR = 'saved-stations';

function ensureStorageDir(): void {
    if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

// ─── Serialization ──────────────────────────────────────────────────────────

function serializeStation(station: GeneratedStation): SerializedStation {
    const rooms = Object.fromEntries(station.rooms) as SerializedStation['rooms'];

    const npcs: Record<string, SerializedNPC> = {};
    for (const [id, npc] of station.npcs) {
        npcs[id] = { ...npc, behaviors: Array.from(npc.behaviors) };
    }

    const items = Object.fromEntries(station.items) as SerializedStation['items'];

    const mapLayout: SerializedMapLayout = {
        seed: station.mapLayout.seed,
        positions: Object.fromEntries(station.mapLayout.positions) as Record<string, { x: number; y: number }>,
        bounds: station.mapLayout.bounds,
        scaleHint: station.mapLayout.scaleHint,
    };

    return {
        config: station.config,
        stationName: station.stationName,
        briefing: station.briefing,
        backstory: station.backstory,
        rooms,
        npcs,
        items,
        objectives: station.objectives,
        entryRoomId: station.entryRoomId,
        escapeRoomId: station.escapeRoomId,
        crewRoster: station.crewRoster,
        arrivalScenario: station.arrivalScenario,
        mapLayout,
    };
}

function deserializeStation(data: SerializedStation): GeneratedStation {
    const rooms = new Map(Object.entries(data.rooms));

    const npcs = new Map<string, NPC>();
    for (const [id, raw] of Object.entries(data.npcs)) {
        npcs.set(id, {
            ...raw,
            behaviors: new Set(raw.behaviors),
        });
    }

    const items = new Map(Object.entries(data.items));

    const mapLayout: MapLayout = {
        seed: data.mapLayout.seed,
        positions: new Map(Object.entries(data.mapLayout.positions)),
        bounds: data.mapLayout.bounds,
        scaleHint: data.mapLayout.scaleHint,
    };

    return {
        config: data.config,
        stationName: data.stationName,
        briefing: data.briefing,
        backstory: data.backstory,
        rooms,
        npcs,
        items,
        objectives: data.objectives,
        entryRoomId: data.entryRoomId,
        escapeRoomId: data.escapeRoomId,
        crewRoster: data.crewRoster,
        arrivalScenario: data.arrivalScenario,
        mapLayout,
    };
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/** List all saved stations (metadata only, sorted newest first). */
export function listSavedStations(): SavedStationMeta[] {
    ensureStorageDir();

    const files = readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json'));
    const metas: SavedStationMeta[] = [];

    for (const file of files) {
        try {
            const raw = readFileSync(join(STORAGE_DIR, file), 'utf-8');
            const parsed = JSON.parse(raw) as SavedStationFile;
            metas.push({
                id: parsed.id,
                stationName: parsed.stationName,
                briefing: parsed.briefing,
                difficulty: parsed.difficulty,
                savedAt: parsed.savedAt,
            });
        } catch {
            // Skip corrupt files
        }
    }

    // Newest first
    metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return metas;
}

/** Save a generated station to disk. Returns the assigned ID. */
export function saveStation(station: GeneratedStation): string {
    ensureStorageDir();

    const id = crypto.randomUUID();
    const file: SavedStationFile = {
        id,
        stationName: station.stationName,
        briefing: station.briefing,
        difficulty: station.config.difficulty,
        savedAt: new Date().toISOString(),
        station: serializeStation(station),
    };

    writeFileSync(join(STORAGE_DIR, `${id}.json`), JSON.stringify(file));
    return id;
}

/** Load a saved station by ID. Returns null if not found or corrupt. */
export function loadStation(id: string): GeneratedStation | null {
    try {
        const raw = readFileSync(join(STORAGE_DIR, `${id}.json`), 'utf-8');
        const parsed = JSON.parse(raw) as SavedStationFile;
        return deserializeStation(parsed.station);
    } catch {
        return null;
    }
}

/** Delete a saved station by ID. */
export function deleteStation(id: string): void {
    try {
        unlinkSync(join(STORAGE_DIR, `${id}.json`));
    } catch {
        // File already gone — no-op
    }
}
