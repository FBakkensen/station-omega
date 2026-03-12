#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectLegacyGameEntries,
  parseJsonLines,
  type RawGameDoc,
  type RawTurnSegmentDoc,
} from "./purge-legacy-games.helpers.js";

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

function listLegacyGames() {
  const rawGames = runConvex(["data", "games", "--format", "jsonLines"]);
  const rawTurnSegments = runConvex(["data", "turnSegments", "--format", "jsonLines"]);

  return collectLegacyGameEntries(
    parseJsonLines<RawGameDoc>(rawGames),
    parseJsonLines<RawTurnSegmentDoc>(rawTurnSegments),
  );
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