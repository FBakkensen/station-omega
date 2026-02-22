import { describe, expect, it, vi } from "vitest";
import { Script, createContext } from "node:vm";
import type { Id } from "../_generated/dataModel";
import { processAITurn } from "./streamTurn";

type TurnArgs = {
  gameId: Id<"games">;
  playerInput: string;
  turnNumber: number;
};

type MutationCall = {
  ref: unknown;
  args: unknown;
};

type SegmentSaveArgs = {
  gameId: Id<"games">;
  turnNumber: number;
  segmentIndex: number;
  segment: {
    type: string;
    text: string;
    npcId: string | null;
    crewName: string | null;
  };
};

type FakeActionCtx = {
  runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
  runMutation: (ref: unknown, args: unknown) => Promise<null>;
};

const handler = (
  processAITurn as unknown as {
    _handler: (ctx: FakeActionCtx, args: TurnArgs) => Promise<null>;
  }
)._handler;

function makeArgs(overrides?: Partial<TurnArgs>): TurnArgs {
  return {
    gameId: "game-1" as Id<"games">,
    playerInput: "scan relay",
    turnNumber: 1,
    ...overrides,
  };
}

function createCtx(options?: {
  gameResult?: unknown;
  stationResult?: unknown;
  throwOnGameQuery?: Error;
  throwOnStationQuery?: Error;
}) {
  const mutationCalls: MutationCall[] = [];
  let expectStationQuery = false;

  const runQuery = vi.fn(() => {
    if (!expectStationQuery) {
      if (options?.throwOnGameQuery !== undefined) {
        return Promise.reject(options.throwOnGameQuery);
      }

      const game = options?.gameResult ?? null;
      expectStationQuery = game !== null;
      return Promise.resolve(game);
    }

    expectStationQuery = false;
    if (options?.throwOnStationQuery !== undefined) {
      return Promise.reject(options.throwOnStationQuery);
    }
    return Promise.resolve(options?.stationResult ?? null);
  });

  const runMutation = vi.fn((ref: unknown, args: unknown) => {
    mutationCalls.push({ ref, args });
    return Promise.resolve(null);
  });

  const ctx: FakeActionCtx = {
    runQuery,
    runMutation,
  };

  return { ctx, mutationCalls, runMutation, runQuery };
}

function createCrossRealmError(message: string): Error {
  return new Script(`new Error(${JSON.stringify(message)})`).runInContext(
    createContext({}),
  ) as Error;
}

function releaseCalls(calls: MutationCall[]): Array<{ gameId: Id<"games"> }> {
  return calls
    .map((call) => call.args)
    .filter((args): args is { gameId: Id<"games"> } => {
      if (!args || typeof args !== "object") return false;
      const value = args as Record<string, unknown>;
      return Object.keys(value).length === 1 && "gameId" in value;
    });
}

function diagnosticCalls(calls: MutationCall[]): SegmentSaveArgs[] {
  return calls
    .map((call) => call.args)
    .filter((args): args is SegmentSaveArgs => {
      if (!args || typeof args !== "object") return false;
      const value = args as Record<string, unknown>;
      if (!("segment" in value)) return false;
      const segment = value.segment;
      if (!segment || typeof segment !== "object") return false;
      return (segment as Record<string, unknown>).type === "diagnostic_readout";
    });
}

describe("processAITurn failure safety behavior", () => {
  it("[Z] releases lock and persists a diagnostic when required game is missing", async () => {
    const { ctx, mutationCalls } = createCtx();
    const args = makeArgs();

    await expect(handler(ctx, args)).resolves.toBeNull();

    expect(releaseCalls(mutationCalls)).toEqual([{ gameId: args.gameId }]);
    expect(diagnosticCalls(mutationCalls)).toMatchObject([
      {
        gameId: args.gameId,
        turnNumber: args.turnNumber,
        segmentIndex: 999,
        segment: {
          type: "diagnostic_readout",
          text: "**System Error:** Game not found",
          npcId: null,
          crewName: null,
        },
      },
    ]);
  });

  it("[O] persists one diagnostic when a single dependency is missing", async () => {
    const { ctx, mutationCalls } = createCtx({
      gameResult: { stationId: "station-1" as Id<"stations"> },
      stationResult: null,
    });
    const args = makeArgs();

    await expect(handler(ctx, args)).resolves.toBeNull();

    expect(releaseCalls(mutationCalls)).toHaveLength(1);
    expect(diagnosticCalls(mutationCalls)).toHaveLength(1);
    expect(diagnosticCalls(mutationCalls)[0]?.segment.text).toBe(
      "**System Error:** Station not found",
    );
  });

  it("[M] isolates multiple failed turns with one release and diagnostic per attempt", async () => {
    const { ctx, mutationCalls } = createCtx();

    await expect(handler(ctx, makeArgs({ turnNumber: 1 }))).resolves.toBeNull();
    await expect(handler(ctx, makeArgs({ turnNumber: 2 }))).resolves.toBeNull();

    expect(releaseCalls(mutationCalls)).toHaveLength(2);
    expect(diagnosticCalls(mutationCalls).map((call) => call.turnNumber)).toEqual([1, 2]);
  });

  it("[B] writes diagnostic records at boundary index 999 on failures", async () => {
    const { ctx, mutationCalls } = createCtx({
      throwOnGameQuery: new Error("upstream crashed"),
    });

    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    expect(diagnosticCalls(mutationCalls).map((call) => call.segmentIndex)).toEqual([999]);
  });

  it("[I] persists diagnostic contract shape with expected interface fields", async () => {
    const { ctx, mutationCalls } = createCtx();

    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const diagnostics = diagnosticCalls(mutationCalls);
    expect(diagnostics).toHaveLength(1);
    const persisted = diagnostics[0];
    expect(persisted.segment.type).toBe("diagnostic_readout");
    expect(Object.keys(persisted.segment).sort()).toEqual([
      "crewName",
      "npcId",
      "text",
      "type",
    ]);
    expect(persisted.segment.text.startsWith("**System Error:**")).toBe(true);
  });

  it("[E] falls back to a safe message when a non-Error value is thrown", async () => {
    const { ctx, mutationCalls } = createCtx({
      throwOnGameQuery: createCrossRealmError("cross-realm failure"),
    });

    await expect(handler(ctx, makeArgs())).resolves.toBeNull();

    const diagnostics = diagnosticCalls(mutationCalls);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].segment.text).toBe(
      "**System Error:** Unknown error during turn",
    );
  });

  it("[S] follows the standard failure flow by returning null while surfacing diagnostics", async () => {
    const { ctx, mutationCalls, runQuery } = createCtx();
    const args = makeArgs();

    await expect(handler(ctx, args)).resolves.toBeNull();

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), { id: args.gameId });
    expect(releaseCalls(mutationCalls)).toHaveLength(1);
    expect(diagnosticCalls(mutationCalls)).toHaveLength(1);
  });
});
