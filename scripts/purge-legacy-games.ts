#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RawGameDoc = {
  _id: string;
  npcOverrides?: unknown;
  state?: {
    npcAllies?: unknown;
    metrics?: {
      npcInteractions?: unknown;
    };
  };
};

type LegacyReason = "npcOverrides" | "state.npcAllies" | "state.metrics.npcInteractions";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");

function runConvex(commandArgs: string[]) {
  const result = spawnSync("bunx", ["convex", ...commandArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Convex command failed.\n");
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function detectLegacyReasons(doc: RawGameDoc): LegacyReason[] {
  const reasons: LegacyReason[] = [];
  if (Object.prototype.hasOwnProperty.call(doc, "npcOverrides")) {
    reasons.push("npcOverrides");
  }
  if (Object.prototype.hasOwnProperty.call(doc.state ?? {}, "npcAllies")) {
    reasons.push("state.npcAllies");
  }
  if (Object.prototype.hasOwnProperty.call(doc.state?.metrics ?? {}, "npcInteractions")) {
    reasons.push("state.metrics.npcInteractions");
  }
  return reasons;
}

function listLegacyGames() {
  const rawOutput = runConvex(["data", "games", "--format", "jsonLines"]);
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawGameDoc)
    .map((doc) => ({ id: doc._id, reasons: detectLegacyReasons(doc) }))
    .filter((entry) => entry.reasons.length > 0);
}

const legacyGames = listLegacyGames();

if (legacyGames.length === 0) {
  console.log("No legacy NPC-era games found in the current Convex deployment.");
  process.exit(0);
}

console.log(`Found ${String(legacyGames.length)} legacy game entries:`);
for (const game of legacyGames) {
  console.log(`- ${game.id} (${game.reasons.join(", ")})`);
}

if (!apply) {
  console.log("Dry run only. Re-run with --apply to purge these games and all dependent records.");
  process.exit(0);
}

const batchSize = 25;
for (let index = 0; index < legacyGames.length; index += batchSize) {
  const batch = legacyGames.slice(index, index + batchSize).map((game) => game.id);
  const result = runConvex([
    "run",
    "maintenance:purgeGames",
    JSON.stringify({ gameIds: batch }),
  ]);
  process.stdout.write(result);
}

console.log(`Purged ${String(legacyGames.length)} legacy game entries.`);