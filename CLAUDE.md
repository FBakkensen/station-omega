# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev (all) | `bun run dev` (Convex + web) |
| Dev web only | `bun run dev:web` |
| Dev convex only | `bun run dev:convex` |
| Full QA gate | `bun run check` (must pass before returning results) |
| Static checks only | `bun run check:static` |
| Deterministic tests only | `bun run check:tests` |
| Run single test file | `vitest run path/to/file.test.ts` |
| Watch tests | `vitest` or `bun run test:det:watch` |
| Web tests | `bun run test:web` |
| Typecheck root | `bun run typecheck` |
| Typecheck convex | `bun run typecheck:convex` |
| Typecheck web | `bun run typecheck:web` |
| Lint root | `bun run lint` |
| Lint web | `bun run lint:web` |
| Dead code | `bun run deadcode` |
| Generation fixture | `bun run test:fixture` |
| Creative layer test | `bun run test:creative` |
| Game master test | `bun run test:gm` |
| Playwright | `bun run pw -- <command>` |
| AI logs | `bun run ai-logs <cmd>` (recent, game \<id\> --turn=N, detail \<logId\>, errors, stats) |

## Architecture

Station Omega is an AI-narrated web game with three code zones sharing TypeScript:

```
src/          — shared game engine (consumed by Convex actions + tests)
convex/       — backend: actions, queries, mutations, schema, persistence
web/          — React + Vite + Tailwind frontend (separate workspace)
```

Each zone has its own tsconfig. Root tsconfig excludes `web/` and `convex/`. The web workspace has its own `package.json` and node_modules.

### Core Design Pattern: Tool-Driven Gameplay

The AI is game master but does **not** control state. Tools (`src/tools.ts`) produce mechanical state transitions; the AI narrates results. Mechanics live in tools/engine code, prose lives in prompt/model layers. Never mix these concerns.

### Station Generation Pipeline (5 layers)

1. **Topology** (`src/generation/layers/topology.ts`) — AI generates scenario, connectivity constraints
2. **Systems/Items** (`src/generation/layers/systems-items-procedural.ts`) — deterministic failures/items from topology
3. **Objectives/NPCs** (`src/generation/layers/objectives-npcs.ts`) — AI generates objective chains, NPC concepts
4. **Creative** (`src/generation/layers/creative.ts`) — orchestrates parallel sub-layers (identity, rooms, items, arrival, NPCs)
5. **Validate + Assemble** (`src/generation/validate.ts` + `src/assembly.ts`) — combines into `GeneratedStation`

### Turn Lifecycle

`convex/actions/streamTurn.ts` coordinates turn execution. `convex/turnLocks.ts` guards concurrency. `convex/turnSegments.ts` handles streamed segment persistence. Frontend consumes segments via Convex subscriptions.

## Testing

- **`bun run check`** is the canonical QA gate — run for every code change.
- For generation/prompt changes, also run `test:fixture`, `test:creative`, `test:gm`.
- For gameplay changes, use Playwright: `bun run pw -- <command>` (run sequentially, not in parallel).
- Use `http://localhost:5173/?devfast=1` for fast manual/Playwright smoke tests (mutes audio, speeds typewriter).

### ZOMBIES Test Convention

Every `it()`/`test()` title must start with exactly one prefix: `[Z]`, `[O]`, `[M]`, `[B]`, `[I]`, `[E]`, or `[S]`. Every `describe()` block must contain all seven. Enforced by `bun run test:zombies`.

- Z=Zero, O=One, M=Many, B=Boundary, I=Interface/Invariant, E=Error/Exception, S=Simple happy path

## Coding Conventions

- TypeScript strict mode, 2-space indent, kebab-case filenames
- `camelCase` variables/functions, `PascalCase` types/interfaces/classes
- Schema-first AI interfaces (Zod-backed structured outputs, `inputSchema`)
- Prefer shared types from `src/types.ts` and `src/schema.ts` over local variants
- `tool()` handlers can be synchronous if no `await` is needed

## Commits & PRs

Concise imperative style (`Add ...`, `Fix ...`, `Refactor ...`). PRs include: behavior summary, commands run, gameplay impact, and prompt/agent changes if AI behavior is modified.
