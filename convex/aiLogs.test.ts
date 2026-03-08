import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { log, prune, recent, byGame, byStation, errors, detail, stats } from "./aiLogs";
import { extractHandler } from "./test_utils";

// ── Types ────────────────────────────────────────────────────────────

type AiLogDoc = {
  _id: string;
  _creationTime: number;
  provider: "openrouter" | "fal" | "inworld";
  operation: "station_generation" | "game_turn" | "image_generation" | "video_generation" | "tts";
  stationId?: string;
  gameId?: string;
  turnNumber?: number;
  modelId?: string;
  prompt?: string;
  response?: string;
  status: "success" | "error" | "cache_hit";
  error?: string;
  durationMs: number;
  metadata?: unknown;
};

// ── Harness ──────────────────────────────────────────────────────────

function createAiLogsHarness(initialDocs: AiLogDoc[] = []) {
  const docs = new Map<string, AiLogDoc>();
  let counter = initialDocs.length;
  for (const doc of initialDocs) docs.set(doc._id, doc);

  const deletedIds: string[] = [];

  function matchIndex(indexName: string, doc: AiLogDoc, captured: Record<string, unknown>): boolean {
    const indexFields: Record<string, string[]> = {
      by_station: ["stationId"],
      by_game_turn: ["gameId", "turnNumber"],
      by_provider: ["provider"],
      by_operation: ["operation"],
      by_status: ["status"],
    };
    const fields = indexFields[indexName] ?? [];
    return fields.every((f) => {
      if (!(f in captured)) return true;
      return (doc as Record<string, unknown>)[f] === captured[f];
    });
  }

  function buildQueryChain(indexName: string | null, captured: Record<string, unknown>) {
    let ordering: "asc" | "desc" = "asc";
    const chain = {
      order: (dir: "asc" | "desc") => {
        ordering = dir;
        return chain;
      },
      take: (n: number) => {
        let filtered = [...docs.values()];
        if (indexName) filtered = filtered.filter((d) => matchIndex(indexName, d, captured));
        filtered.sort((a, b) =>
          ordering === "desc" ? b._creationTime - a._creationTime : a._creationTime - b._creationTime,
        );
        return Promise.resolve(filtered.slice(0, n));
      },
      collect: () => {
        let filtered = [...docs.values()];
        if (indexName) filtered = filtered.filter((d) => matchIndex(indexName, d, captured));
        filtered.sort((a, b) =>
          ordering === "desc" ? b._creationTime - a._creationTime : a._creationTime - b._creationTime,
        );
        return Promise.resolve(filtered);
      },
    };
    return chain;
  }

  const ctx = {
    db: {
      insert: vi.fn((_table: string, document: Record<string, unknown>) => {
        counter++;
        const id = `ailog-${String(counter)}`;
        const stored = { ...document, _id: id, _creationTime: Date.now() } as AiLogDoc;
        docs.set(id, stored);
        return Promise.resolve(id);
      }),
      delete: vi.fn((id: string) => {
        deletedIds.push(id);
        docs.delete(id);
        return Promise.resolve();
      }),
      get: vi.fn((id: string) => Promise.resolve(docs.get(id) ?? null)),
      query: vi.fn((_table: string) => ({
        order: (dir: "asc" | "desc") => buildQueryChain(null, {}).order(dir),
        take: (n: number) => buildQueryChain(null, {}).take(n),
        collect: () => buildQueryChain(null, {}).collect(),
        withIndex: (indexName: string, callback: (q: Record<string, unknown>) => unknown) => {
          const captured: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            eq: (field: string, value: unknown) => {
              captured[field] = value;
              return builder;
            },
          };
          callback(builder);
          return buildQueryChain(indexName, captured);
        },
      })),
    },
  };

  return { ctx, docs, deletedIds };
}

// ── Extract handlers ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;
const logHandler = extractHandler<Ctx, Record<string, unknown>, null>(log);
const pruneHandler = extractHandler<Ctx, Record<string, unknown>, number>(prune);
const recentHandler = extractHandler<Ctx, Record<string, unknown>, unknown[]>(recent);
const byGameHandler = extractHandler<Ctx, Record<string, unknown>, unknown[]>(byGame);
const _byStationHandler = extractHandler<Ctx, Record<string, unknown>, unknown[]>(byStation);
const errorsHandler = extractHandler<Ctx, Record<string, unknown>, unknown[]>(errors);
const detailHandler = extractHandler<Ctx, Record<string, unknown>, unknown>(detail);
const statsHandler = extractHandler<Ctx, Record<string, unknown>, unknown>(stats);

// ── Tests ────────────────────────────────────────────────────────────

describe("AI log structured persistence and querying", () => {
  it("[Z] inserts exactly one document when logging from an empty state", async () => {
    const { ctx, docs } = createAiLogsHarness();
    expect(docs.size).toBe(0);

    await logHandler(ctx, {
      provider: "openrouter",
      operation: "game_turn",
      status: "success",
      durationMs: 1000,
    });

    expect(docs.size).toBe(1);
  });

  it("[O] retrieves one log entry with full prompt and response via detail", async () => {
    const prompt = "System prompt with full detail content here";
    const response = '{"segments":[{"type":"narration","text":"Hello"}]}';
    const { ctx } = createAiLogsHarness([
      {
        _id: "log-1",
        _creationTime: 1000,
        provider: "openrouter",
        operation: "game_turn",
        prompt,
        response,
        status: "success",
        durationMs: 500,
        gameId: "game-1",
        turnNumber: 1,
      },
    ]);

    const result = await detailHandler(ctx, { id: "log-1" }) as AiLogDoc;
    expect(result.prompt).toBe(prompt);
    expect(result.response).toBe(response);
    expect(result.provider).toBe("openrouter");
  });

  it("[M] returns many logs filtered by provider and ordered by creation time desc", async () => {
    const { ctx } = createAiLogsHarness([
      { _id: "a1", _creationTime: 100, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 10 },
      { _id: "a2", _creationTime: 200, provider: "fal", operation: "image_generation", status: "success", durationMs: 20 },
      { _id: "a3", _creationTime: 300, provider: "openrouter", operation: "station_generation", status: "success", durationMs: 30 },
      { _id: "a4", _creationTime: 400, provider: "inworld", operation: "tts", status: "success", durationMs: 40 },
    ]);

    const result = await recentHandler(ctx, { provider: "openrouter" }) as AiLogDoc[];
    expect(result).toHaveLength(2);
    expect(result[0]._id).toBe("a3");
    expect(result[1]._id).toBe("a1");
  });

  it("[B] prune respects the 30-day boundary threshold and keeps recent entries", async () => {
    const now = Date.now();
    const beyondLimit = 31 * 24 * 60 * 60 * 1000;
    const { ctx, docs, deletedIds } = createAiLogsHarness([
      { _id: "old-1", _creationTime: now - beyondLimit, provider: "fal", operation: "image_generation", status: "success", durationMs: 10 },
      { _id: "old-2", _creationTime: now - beyondLimit - 1000, provider: "openrouter", operation: "game_turn", status: "error", durationMs: 20 },
      { _id: "new-1", _creationTime: now - 1000, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 30 },
    ]);

    const deleted = await pruneHandler(ctx, {});
    expect(deleted).toBe(2);
    expect(deletedIds).toContain("old-1");
    expect(deletedIds).toContain("old-2");
    expect(docs.has("new-1")).toBe(true);
  });

  it("[I] stats returns interface-conforming shape with byProvider, byOperation, and counts", async () => {
    const { ctx } = createAiLogsHarness([
      { _id: "s1", _creationTime: 100, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 100 },
      { _id: "s2", _creationTime: 200, provider: "fal", operation: "image_generation", status: "error", durationMs: 200 },
      { _id: "s3", _creationTime: 300, provider: "openrouter", operation: "station_generation", status: "success", durationMs: 300 },
    ]);

    const result = await statsHandler(ctx, {}) as Record<string, unknown>;
    expect(result.totalCount).toBe(3);
    expect(result.errorCount).toBe(1);
    expect(result.avgDurationMs).toBe(200);
    expect((result.byProvider as Record<string, number>).openrouter).toBe(2);
    expect((result.byProvider as Record<string, number>).fal).toBe(1);
    expect((result.byOperation as Record<string, number>).game_turn).toBe(1);
  });

  it("[E] errors query returns only error-status entries", async () => {
    const { ctx } = createAiLogsHarness([
      { _id: "e1", _creationTime: 100, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 10 },
      { _id: "e2", _creationTime: 200, provider: "fal", operation: "image_generation", status: "error", error: "timeout", durationMs: 20 },
      { _id: "e3", _creationTime: 300, provider: "openrouter", operation: "game_turn", status: "error", error: "rate limit", durationMs: 30 },
    ]);

    const result = await errorsHandler(ctx, {}) as AiLogDoc[];
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.status === "error")).toBe(true);
  });

  it("[S] byGame returns logs for a specific game filtered by optional turn number", async () => {
    const gid = "game-42" as Id<"games">;
    const { ctx } = createAiLogsHarness([
      { _id: "g1", _creationTime: 100, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 10, gameId: gid, turnNumber: 1 },
      { _id: "g2", _creationTime: 200, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 20, gameId: gid, turnNumber: 2 },
      { _id: "g3", _creationTime: 300, provider: "fal", operation: "image_generation", status: "success", durationMs: 30, gameId: gid, turnNumber: 2 },
      { _id: "g4", _creationTime: 400, provider: "openrouter", operation: "game_turn", status: "success", durationMs: 40, gameId: "game-99", turnNumber: 1 },
    ]);

    const allForGame = await byGameHandler(ctx, { gameId: gid }) as AiLogDoc[];
    expect(allForGame).toHaveLength(3);

    const turn2Only = await byGameHandler(ctx, { gameId: gid, turnNumber: 2 }) as AiLogDoc[];
    expect(turn2Only).toHaveLength(2);
    expect(turn2Only.every((d) => d.turnNumber === 2)).toBe(true);
  });
});
