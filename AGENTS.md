# Repository Guidelines

`AGENTS.md` is the single source of truth for repository-level coding instructions in Station Omega. Keep this file up to date and avoid maintaining parallel instruction files with overlapping guidance.

## Project Structure & Module Organization
Station Omega is a web-first game with a Bun-powered TypeScript backend/shared engine and a React frontend.

- `web/`: React + Vite client.
  - `web/src/screens/`: app flow screens (`Title`, station picker, gameplay, game over, run summary/history).
  - `web/src/components/`: UI building blocks (narrative, sidebar, input, modals).
  - `web/src/hooks/`: stateful gameplay hooks (`useGameSetup`, `useStreamingTurn`, keyboard/preferences/TTS helpers).
  - `web/src/engine/`: streaming segment parser and rendering/scoring helpers.
  - `web/src/styles/`: global CSS and theme tokens.
- `convex/`: backend actions, queries, mutations, schema, and persistence.
  - `convex/actions/`: runtime orchestration (`generateStation`, `streamTurn`, `ttsProxy`).
  - `convex/turns.ts`, `convex/turnLocks.ts`, `convex/turnSegments.ts`: turn lifecycle, locking, and streamed segment persistence.
  - `convex/stations.ts`, `convex/stationGeneration.ts`, `convex/generationProgress.ts`: station persistence and generation status.
  - `convex/_generated/`: generated API/data model bindings.
- `src/`: shared game domain and generation logic.
  - `src/tools.ts`: gameplay actions as `tool()` handlers.
  - `src/prompt.ts`: system prompt construction and narration/tool contract framing.
  - `src/schema.ts`, `src/types.ts`, `src/model-catalog.ts`, `src/validation.ts`: shared contracts, model selection, and validation.
  - `src/generation/`: layered station generation pipeline and orchestration.
  - `src/assembly.ts`, `src/character.ts`, `src/events.ts`, `src/graph.ts`, `src/map-layout.ts`: core game mechanics and assembly.
  - `src/data.ts`, `src/environment.ts`, `src/turn-context.ts`, `src/generation-log.ts`, `src/json-stream-parser.ts`: runtime config/context/logging utilities.
- `test/`: fixture generation and quality checks for generation and game master behavior.
- `package.json`, `tsconfig.json`, `eslint.config.js`, `knip.json`: root tooling configuration.

## Architecture
- Gameplay is AI-narrated and tool-driven: tools produce state transitions, while narration is generated from tool/state results.
- Shared gameplay and generation logic lives in `src/` and is consumed by Convex actions and test tooling.
- `convex/actions/generateStation.ts` runs shared generation with progress callbacks and persists assembled stations/metadata.
- `convex/actions/streamTurn.ts` coordinates turn execution while lock/segment modules guard concurrency and stream updates.
- Frontend rendering lives in `web/` and consumes Convex-backed game state plus streamed turn segments.

### Station Generation Pipeline
1. `src/generation/layers/topology.ts`: AI-generated topology, scenario, and connectivity constraints.
2. `src/generation/layers/systems-items-procedural.ts`: deterministic failures/items pass from topology.
3. `src/generation/layers/objectives-npcs.ts`: AI-generated objective chain and NPC concepts.
4. `src/generation/layers/creative.ts`: orchestrates parallel creative sub-layers (`creative-identity`, `creative-rooms`, `creative-items`, `creative-arrival`, `creative-npcs`).
5. `src/generation/validate.ts` + `src/assembly.ts`: validates and combines outputs into `GeneratedStation` maps used by Convex persistence and clients.

### Key Design Constraints
- Keep AI as game master: tools return mechanical state, not prose.
- Tool execution and event state drive combat, inventory, movement, locks, and room transitions.
- Keep enemy/room/item updates in shared state and persist relevant state through Convex-backed game context.
- Prefer explicit shared types and schema-first interfaces between backend and frontend.

## Build, Test, and Development Commands
- `bun install` installs root dependencies.
- `bun run dev` starts Convex + web dev servers together. Convex dev hot-reloads functions to the cloud deployment while providing a local proxy for the web app.
- `bun run dev:web` starts only the web app.
- `bun run dev:convex` starts only Convex dev.
- `bun run typecheck` runs root `tsc --noEmit` checks.
- `bun run typecheck:convex` runs Convex TypeScript checks.
- `bun run typecheck:web` runs the web workspace typecheck (`tsc -b`).
- `bun run lint` runs root strict type-aware ESLint.
- `bun run lint:web` runs the web workspace ESLint checks.
- `bun run deadcode` runs `knip` for unused exports/files.
- `bun run build:web` builds the web app (`tsc -b && vite build`).
- `bun run check:static` runs root + web static quality checks (`typecheck`, `typecheck:convex`, `lint`, `deadcode`, `typecheck:web`, `lint:web`).
- `bun run check:tests` runs deterministic test gates (`test:zombies`, `test:det`, `test:web`).
- `bun run qa` runs `check:static` + `check:tests`.
- `bun run check` is the canonical all-in-one QA target and must pass clean before returning results for code changes.
- `bun run test:fixture` generates fixture outputs for station generation.
- `bun run test:creative` runs creative-layer quality checks.
- `bun run test:gm` runs game master behavior checks.
- `bun run test:analyze` analyzes test run outputs.
- `bun run pw -- <command>` runs repo-local Playwright CLI commands.

## Coding Style & Naming Conventions
- TypeScript strict style with explicit, readable data shapes.
- Indentation: 2 spaces.
- File naming: kebab-case (`json-stream-parser.ts`).
- Naming: `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types.
- Keep mechanics code focused and narrative behavior in prompt/agent logic.
- Reuse shared helpers and shared domain types before introducing new local variants.

## Testing Guidelines
- Run `bun run check` for every code change and do not return results unless it passes clean.
- For generation and prompt/game-master changes, run relevant scripts (`bun run test:fixture`, `bun run test:creative`, `bun run test:gm`) before returning.
- For gameplay changes, run the manual smoke path in the web client through the repo-local Playwright CLI (`bun run pw -- <command>`).
- Use `http://localhost:5173/?devfast=1` for manual and Playwright gameplay smoke tests to force mute and massively speed up typewriter reveal during development.
- Run Playwright CLI commands sequentially (not in parallel) to avoid Bun extraction/cache race errors such as `FileNotFound: copying file ...`.
- The manual smoke path should cover station setup, movement, combat/action tools, inventory, turn streaming, and persistence/reload behavior.
- Capture Playwright snapshots for key checkpoints and include a concise pass/fail summary in your final report.
- Documentation-only changes do not require `bun run check` unless they modify executable config or validated examples.

### ZOMBIES Deterministic Test Principles
- Every deterministic `it(...)` / `test(...)` title must start with exactly one ZOMBIES prefix: `[Z]`, `[O]`, `[M]`, `[B]`, `[I]`, `[E]`, or `[S]`, followed by a space and descriptive text.
- Stacked prefixes in one title (for example `[Z][O][M][B][I][E][S] ...`) are not allowed.
- Every `describe(...)` block must contain all seven principles at least once. Additional tagged tests are allowed, but untagged tests are not.
- `bun run test:zombies` is a blocking gate in `bun run check` and must pass locally before returning results.

Principle definitions:
- `Z` (Zero): zero/empty/null/absent input or state.
- `O` (One): singular or minimal valid case.
- `M` (Many): multi-entity, sequence, or larger-scale behavior.
- `B` (Boundary): edge limits, thresholds, and bound transitions.
- `I` (Interface/Invariant): shape, contract, and invariant behavior.
- `E` (Error/Exception): invalid input, failures, thrown/rejected paths.
- `S` (Simple): nominal, standard happy-path behavior.

Title examples:
- `[Z] returns no segments for empty deltas`
- `[O] extracts one complete segment from a single chunk`
- `[M] handles many chunk boundaries while preserving order`
- `[B] keeps boundary behavior stable at threshold values`
- `[I] preserves the GameStatusData contract fields`
- `[E] rejects malformed payloads with explicit diagnostics`
- `[S] follows standard diagnose flow for in-room failures`

## Tool-Specific Notes
- Keep this file authoritative; do not reintroduce duplicated instruction files for individual assistants.
- `tool()` handlers can stay synchronous if no `await` is needed.
- Use schema-first AI interfaces (`inputSchema`, Zod-backed structured outputs) and keep dynamic per-turn state in context messages rather than mutating prompt strings.
- Preserve the tool-driven gameplay contract: mechanics live in tools/shared engine code, while prose behavior lives in prompt/model layers.

## Commit & Pull Request Guidelines
Recent commit style is concise and imperative (`Replace ...`, `Add ...`, `Refactor ...`).

PRs should include:
- short behavior summary,
- commands run,
- gameplay impact and assumptions,
- relevant prompt/agent changes when AI behavior is modified.

## Security & Configuration Notes
- Never commit `.env.local` or API keys.
- Keep required API secrets (`OPENAI_API_KEY`, `INWORLD_API_KEY`) local.
- Treat `run-history.json` as local test/run state; avoid sharing or committing personal run artifacts.
