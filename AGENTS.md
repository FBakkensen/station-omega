# Repository Guidelines

## Project Structure & Module Organization
Station Omega is a Bun-powered TypeScript game.

- `index.ts`: Main game loop, agent wiring, streaming orchestration, and UI lifecycle.
- `tui.ts`: Terminal UI built with `@opentui/core` (cards, panels, input, status views).
- `src/`: Domain modules:
  - `src/tools.ts`: all gameplay actions as `tool()` handlers.
  - `src/prompt.ts`: system prompt construction.
  - `src/schema.ts`: output schemas and segment rendering guards.
  - `src/types.ts`: game domain types.
  - `src/generation/index.ts`: station generation orchestrator.
  - `src/generation/layers/`: topology/objective/creative generation layers.
  - `src/generation/layers/systems-items-procedural.ts`: deterministic Layer 2 systems/items generation.
  - `src/assembly.ts`: combines generated skeleton + creative payload into `GeneratedStation`.
  - `src/character.ts`, `src/events.ts`, `src/scoring.ts`, `src/graph.ts`: core game mechanics.
  - `src/json-stream-parser.ts`, `src/segment-style.ts`, `src/markdown-reveal.ts`, `src/tts.ts`: stream parsing, rendering, and speech.
- `package.json`, `tsconfig.json`, `eslint.config.js`: project configuration.
- `run-history.json` and `.env.local`: local runtime/config data; treat as mutable local state, not checked-in source.

## Architecture
- Gameplay is AI-narrated but tool-driven: the LLM calls tools for stateful actions, while narration is produced from tool/state results.
- `index.ts` maintains client-side `ModelMessage[]` conversation history, sent each turn via `streamText({ messages })`.
- System prompt is static; dynamic context is passed per turn via system-role messages.
- `src/tools.ts` uses closure-captured `GameContext` in the `createGameToolSets()` factory.

### Streaming & Rendering Flow
1. `streamText()` streams JSON deltas from the model via `fullStream`.
2. `StreamingSegmentParser` extracts complete `GameSegment` objects.
3. Segments are normalized/resolved (`resolveSegment`) and converted to display-safe markdown/chunks.
4. TUI renders each segment as a typed card.
5. Typewriter reveal and TTS progress from resolved chunks for synchronized output.

### Station Generation Pipeline
1. `src/generation/layers/topology.ts`: AI-generated topology, scenario, and connectivity constraints.
2. `src/generation/layers/systems-items-procedural.ts`: deterministic failures/items pass from topology.
3. `src/generation/layers/objectives-npcs.ts`: AI-generated objective chain and NPC concepts.
4. `src/generation/layers/creative.ts`: parallel creative sub-layers (identity, per-room, items, arrival, NPC creative).
5. `src/assembly.ts`: combines generation outputs into `GeneratedStation` maps.

### Key Design Constraints
- Use AI-as-Game-Master model: tools produce raw state changes, not prose.
- Tool execution and event state drive combat, inventory, movement, locks, and room transitions.
- Keep enemy/room/item updates in shared state and persist relevant state in `GameContext`.
- Important SDK/guideline checks: `Agent<GameContext, typeof Schema>` for structured output, sync `tool().execute` when possible, and prefer `Tool<GameContext>` types.

## Build, Test, and Development Commands
- `bun install` installs dependencies.
- `bun run start` starts the game (`bun index.ts`).
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run lint` runs strict type-aware ESLint.
- `bun run deadcode` runs `knip` to detect unused exports/files.

Always run `bun run typecheck`, `bun run lint`, and `bun run deadcode` before returning results to the user.

## Coding Style & Naming Conventions
- TypeScript strict style with explicit, readable data shapes.
- Indentation: 2 spaces.
- File naming: kebab-case (`segment-style.ts`, `json-stream-parser.ts`).
- Naming: `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types.
- Keep mechanics code focused and narrative logic in prompt/agent behavior.

## Testing Guidelines
There is no dedicated test framework in this repository yet.

- Run `bun run typecheck`, `bun run lint`, and `bun run deadcode` for every change.
- For gameplay changes, do a quick manual smoke path: movement, combat/action tools, inventory, and persistence behavior.

## Commit & Pull Request Guidelines
Recent commit style is concise and imperative (`Replace ...`, `Add ...`, `Refactor ...`).

PRs should include:
- short behavior summary,
- commands run,
- gameplay impact and assumptions,
- relevant agent/prompt changes when AI behavior is modified.

## Security & Configuration Notes
- Never commit `.env.local` or API keys.
- Keep required API secrets (`OPENAI_API_KEY`, `INWORLD_API_KEY`) local.
- Treat `run-history.json` as local test/run state; avoid sharing or committing personal run artifacts.
