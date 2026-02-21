# Copilot Instructions for Station Omega

## Overview

Station Omega is an AI-powered engineering survival game.

- `web/` contains the React + Vite frontend.
- `convex/` contains backend queries/mutations/actions.
- `src/` contains shared game mechanics, schemas, prompts, and generation layers.

## Running the App

```bash
bun run dev         # Convex + web dev servers
bun run dev:web     # web only
bun run dev:convex  # Convex only
```

```bash
bun run typecheck   # root tsc --noEmit
bun run lint        # root eslint
bun run deadcode    # knip
```

Always run both `bun run typecheck` and `bun run lint` before returning results to the user. All errors must be resolved before considering a task complete.

## Architecture

- **`src/tools.ts`** - Gameplay tools defined with `tool()` and Zod schemas. Tools mutate shared state via closure-captured `GameContext`.
- **`src/prompt.ts`** - Game master system prompt. Dynamic context is passed per turn.
- **`src/schema.ts`** - Structured output schemas (`GameSegment`, `GameResponse`) and display metadata types.
- **`src/generation/*`** - Layered station generation pipeline.
- **`convex/actions/*`** - Turn streaming, station generation, TTS proxy, and persistence orchestration.
- **`web/src/hooks/useStreamingTurn.ts`** - Client turn orchestration and streamed segment updates.

## Key Conventions

- **Tool-driven gameplay**: The AI never fabricates state transitions; mechanics are resolved through tools.
- **Shared domain model**: Keep game state and generation types in `src/types.ts` and reuse them across backend/test code.
- **Client/backend split**: Rendering logic belongs in `web/`; backend actions and persistence belong in `convex/`.
- **TypeScript strictness**: Keep `strict` typing and clean lint output.
- **ESM modules**: `"type": "module"` is set in `package.json`.
