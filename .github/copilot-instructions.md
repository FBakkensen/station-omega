# Copilot Instructions for Station Omega

## Overview

Station Omega is an AI-powered text adventure game built with the Vercel AI SDK (`ai`) and OpenRouter (`@openrouter/ai-sdk-provider`). The player navigates a procedurally generated derelict space station, fighting enemies, collecting items, interacting with NPCs, and completing objectives to escape. Game logic lives in `index.ts` and `src/tools.ts`, with the terminal UI in `tui.ts`.

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

- **`index.ts`** — Main game loop: uses `streamText()` with client-side `ModelMessage[]` history, `fullStream` iteration, and inline guardrail validation. Manages TTS, UI, event tracking, and player input.
- **`src/tools.ts`** — All 21 game tools defined via `tool()` from `ai` with Zod schemas. Tools access shared `GameContext` via closure capture in `createGameToolSets()`.
- **`src/models.ts`** — Centralized model configuration via `createOpenRouter()`. Change model by editing a string.
- **`src/creative.ts`** — Creative content generation using `streamText()` + `Output.object()` for one-shot station theming.
- **`src/prompt.ts`** — Builds the system prompt. Dynamic state is passed per-turn via system-role messages.
- **`tui.ts`** — Terminal UI built with `@opentui/core`.

## Key Conventions

- **Tool-driven gameplay**: The AI never fabricates game state. All game actions are resolved through `tool()` handlers that read/write the shared `GameContext` via closure capture. New gameplay mechanics should follow this pattern.
- **Closure-captured context**: All tools access `GameContext` via closure in `createGameToolSets()`. The `gameCtx` object is created once and mutated in place.
- **Client-side conversation history**: A `ModelMessage[]` array accumulates full conversation. Sent each turn via `streamText({ messages })`.
- **TypeScript via Bun**: The project uses Bun for direct TypeScript execution without a compile step. `tsconfig.json` is configured with `strict: true` and `noEmit: true`.
- **Linting**: ESLint is configured with `typescript-eslint` `strictTypeChecked` rules via flat config (`eslint.config.js`).
- **ESM modules**: `"type": "module"` is set in `package.json`.
