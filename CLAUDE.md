# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Commands

```bash
# Development
bun run dev          # Run Convex + web together
bun run dev:web      # Run Vite frontend only
bun run dev:convex   # Run Convex backend only

# Quality checks
bun run typecheck    # Root TypeScript checks (tsc --noEmit)
bun run lint         # Root ESLint checks
bun run deadcode     # Dead code detection (knip)
bun run check        # Root + web quality checks

# Optional web-only checks
bun run --cwd web typecheck
bun run --cwd web lint
bun run --cwd web build

# Test scripts (require OPENROUTER_API_KEY)
bun run test:fixture
bun run test:creative
bun run test:gm
bun run test:analyze
```

Always run both `bun run typecheck` and `bun run lint` before considering a task complete.

## Architecture

Station Omega is a web-first game architecture:

- `web/`: React + TypeScript + Vite client.
- `convex/`: backend actions, queries, mutations, schema, and persistence.
- `src/`: shared game engine logic and station generation pipeline.

### Shared Engine (`src/`)

- `src/tools.ts`: gameplay mechanics exposed as AI tool handlers.
- `src/prompt.ts`: game master prompt construction and rules.
- `src/schema.ts`: structured output schema for streamed narrative segments.
- `src/types.ts`: domain model (`GameState`, `GeneratedStation`, NPCs, failures, objectives).
- `src/turn-context.ts`: per-turn dynamic context creation.
- `src/generation/*`: layered station generation pipeline.
- `src/assembly.ts`: merges skeleton + creative generation into final station data.

### Backend (`convex/`)

- `convex/actions/streamTurn.ts`: orchestrates turn streaming + tool execution backend flow.
- `convex/actions/generateStation.ts`: station generation orchestration and persistence updates.
- `convex/actions/ttsProxy.ts`: TTS proxy endpoint for the web client.
- `convex/lib/serialization.ts`: map/set-safe serialization helpers for station and game state.
- `convex/schema.ts` + table files: persistent model for games, turns, segments, history, and progress.

### Frontend (`web/`)

- `web/src/screens/*`: flow and page state.
- `web/src/components/*`: narrative cards, sidebar, inputs, modals.
- `web/src/hooks/useStreamingTurn.ts`: turn lifecycle and streamed segment handling.
- `web/src/hooks/useTTS.ts`: web audio playback and reveal sync.
- `web/src/engine/*`: segment parsing/rendering helpers for React.

## Core Principles

- Tool-driven mechanics: tools mutate state, narration interprets outcomes.
- Shared domain types: keep canonical gameplay types in `src/types.ts`.
- Keep rendering concerns in `web/` and persistence/orchestration in `convex/`.
- Prefer deterministic/stateful logic in engine modules; keep prose behavior in prompt/model layers.
- Preserve TypeScript strictness and lint cleanliness.

## AI SDK Notes

- `tool()` handlers can be sync if no `await` is needed.
- Use `inputSchema` for tool definitions.
- `streamText()` + structured output should stay schema-first (`zod`).
- Keep per-turn dynamic state in context messages, not prompt string mutations.
