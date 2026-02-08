# Copilot Instructions for Station Omega

## Overview

Station Omega is an AI-powered text adventure game built with the OpenAI Agents SDK (`@openai/agents`). The player navigates a procedurally generated derelict space station, fighting enemies, collecting items, interacting with NPCs, and completing objectives to escape. Game logic lives in `index.ts` and `src/tools.ts`, with the terminal UI in `tui.ts`.

## Running the Game

```bash
bun run start        # runs: bun index.ts
```

```bash
bun run typecheck    # runs: tsc --noEmit
bun run lint         # runs: eslint .
```

Always run both `bun run typecheck` and `bun run lint` before returning results to the user. All errors must be resolved before considering a task complete.

## Architecture

- **`index.ts`** — Main game loop: creates an `Agent<GameContext>` with dynamic instructions, `previousResponseId` chaining, and streaming via `run()`. Manages TTS, UI, event tracking, and player input.
- **`src/tools.ts`** — All 16 game tools defined via `tool()` from `@openai/agents` with Zod schemas. Tools access shared state through `RunContext<GameContext>` dependency injection.
- **`src/creative.ts`** — Creative content generation using a separate `Agent` + `run()` for one-shot station theming.
- **`src/prompt.ts`** — Builds the system prompt (static prefix for prompt caching + dynamic state suffix).
- **`tui.ts`** — Terminal UI built with `@opentui/core`.

## Key Conventions

- **Tool-driven gameplay**: The AI never fabricates game state. All game actions are resolved through `tool()` handlers that read/write the shared `GameContext` via `RunContext`. New gameplay mechanics should follow this pattern.
- **`RunContext<GameContext>` dependency injection**: All tools receive game state through the Agents SDK's context mechanism. No closure-captured state.
- **Dynamic instructions**: The `Agent` uses a function for `instructions` that reads from `RunContext` to inject current game state each turn.
- **`previousResponseId` chaining**: Conversation history is managed server-side. Each turn passes only the new user message.
- **TypeScript via Bun**: The project uses Bun for direct TypeScript execution without a compile step. `tsconfig.json` is configured with `strict: true` and `noEmit: true`.
- **Linting**: ESLint is configured with `typescript-eslint` `strictTypeChecked` rules via flat config (`eslint.config.js`).
- **ESM modules**: `"type": "module"` is set in `package.json`.
