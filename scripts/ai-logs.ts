#!/usr/bin/env bun
/**
 * CLI wrapper for querying AI logs stored in Convex.
 *
 * Usage:
 *   bun run ai-logs recent [--provider=X] [--operation=X] [--status=X] [--limit=N]
 *   bun run ai-logs game <gameId> [--turn=N]
 *   bun run ai-logs station <stationId>
 *   bun run ai-logs errors [--limit=N]
 *   bun run ai-logs detail <logId>
 *   bun run ai-logs stats
 *   bun run ai-logs cleanup
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `AI Logs — query structured AI call logs from Convex

Commands:
  recent  [--provider=X] [--operation=X] [--status=X] [--limit=N]
  game    <gameId> [--turn=N]
  station <stationId>
  errors  [--limit=N]
  detail  <logId>
  stats
  cleanup

Examples:
  bun run ai-logs recent
  bun run ai-logs recent --provider=openrouter --limit=5
  bun run ai-logs game j575abc123 --turn=3
  bun run ai-logs detail k97bxyz456
  bun run ai-logs errors --limit=10
  bun run ai-logs stats
  bun run ai-logs cleanup`;

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      flags[match[1]] = match[2];
    }
  }
  return flags;
}

function convexArgs(obj: Record<string, unknown>): string {
  // Remove undefined values
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v;
  }
  return JSON.stringify(clean);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(fn: string, args: Record<string, unknown> = {}): void {
  const jsonArgs = convexArgs(args);
  try {
    execSync(`npx convex run ${fn} '${jsonArgs}'`, {
      stdio: "inherit",
      cwd: projectRoot,
    });
  } catch {
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}

const flags = parseFlags(rest);
const positional = rest.filter((a) => !a.startsWith("--"));

switch (command) {
  case "recent":
    run("aiLogs:recent", {
      limit: flags.limit ? Number(flags.limit) : undefined,
      provider: flags.provider,
      operation: flags.operation,
      status: flags.status,
    });
    break;

  case "game":
    if (!positional[0]) {
      console.error("Usage: ai-logs game <gameId> [--turn=N]");
      process.exit(1);
    }
    run("aiLogs:byGame", {
      gameId: positional[0],
      turnNumber: flags.turn ? Number(flags.turn) : undefined,
    });
    break;

  case "station":
    if (!positional[0]) {
      console.error("Usage: ai-logs station <stationId>");
      process.exit(1);
    }
    run("aiLogs:byStation", { stationId: positional[0] });
    break;

  case "errors":
    run("aiLogs:errors", {
      limit: flags.limit ? Number(flags.limit) : undefined,
    });
    break;

  case "detail":
    if (!positional[0]) {
      console.error("Usage: ai-logs detail <logId>");
      process.exit(1);
    }
    run("aiLogs:detail", { id: positional[0] });
    break;

  case "stats":
    run("aiLogs:stats");
    break;

  case "cleanup":
    console.log("Running AI log cleanup (pruning entries older than 30 days)...");
    run("aiLogs:prune");
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
}
