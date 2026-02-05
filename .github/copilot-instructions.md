# Copilot Instructions for Station Omega

## Overview

Station Omega is a single-file interactive text adventure game powered by the `@github/copilot-sdk`. The player navigates a 6-room derelict space station, fighting enemies, collecting items, and retrieving a black box to win. All game logic, state, UI, and AI integration live in `index.ts`.

## Running the Game

```bash
npm start        # runs: node --import tsx index.ts
```

```bash
npm run typecheck  # runs: tsc --noEmit
npm run lint       # runs: eslint .
```

Always run both `npm run typecheck` and `npm run lint` before returning results to the user. All errors must be resolved before considering a task complete.

## Architecture

The entire application is a single `index.ts` file structured in sections:

1. **Game Data** — `Room` and `Enemy` interfaces, plus the static `ROOMS` array defining all 6 rooms with loot and threats.
2. **Game State** — A mutable singleton `state: GameState` object tracking HP, inventory, room position, and win/loss flags.
3. **Tools** — Five tools defined with `defineTool()` from `@github/copilot-sdk` that the AI model calls to resolve player actions: `look_around`, `move_to`, `pick_up_item`, `use_item`, `attack`.
4. **System Message** — A long prompt instructing the AI to act as a cinematic game master narrator.
5. **Main Loop** — Creates a `CopilotClient` session with streaming enabled and GPT-4.1, then runs a `readline` input loop.

## Key Conventions

- **Tool-driven gameplay**: The AI never fabricates game state. All game actions are resolved through `defineTool` handlers that read/write the shared `state` object. New gameplay mechanics should follow this pattern.
- **Combat is stateless per-round**: Enemy HP is copied from the template each attack call — enemies don't persist HP across rounds within the tool handler. Multi-round fights work because defeated enemies are tracked in `state.roomEnemyDefeated`.
- **Room progression is linear**: Rooms are an ordered array navigated with "forward"/"back". Room index 5 (Command Bridge) requires a keycard. The win condition triggers when returning to room 0 with the black box.
- **TypeScript via tsx**: The project uses `tsx` for direct TypeScript execution without a compile step. `tsconfig.json` is configured with `strict: true` and `noEmit: true` for type-checking only.
- **Linting**: ESLint is configured with `typescript-eslint` `strictTypeChecked` rules via flat config (`eslint.config.js`).
- **ESM modules**: `"type": "module"` is set in `package.json`.
