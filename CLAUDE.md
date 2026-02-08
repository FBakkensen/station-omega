# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run start        # Run the game (bun index.ts)
bun run typecheck    # Type-check with tsc --noEmit
bun run lint         # Lint with ESLint (strict type-checked rules)
```

Always run both `bun run typecheck` and `bun run lint` before considering a task complete. All errors must be resolved.

## Architecture

Station Omega is an AI-powered text adventure game using the OpenAI Agents SDK (`@openai/agents`). Key source files:

- **`index.ts`** — Main game loop: creates an `Agent<GameContext>` with dynamic instructions, `previousResponseId` chaining, and streaming via `run()`. Manages TTS, UI, event tracking, and player input.
- **`src/tools.ts`** — All 16 game tools defined via `tool()` from `@openai/agents` with Zod schemas. Tools access shared state through `RunContext<GameContext>` dependency injection.
- **`src/creative.ts`** — Creative content generation using a separate `Agent` + `run()` for one-shot station theming.
- **`src/prompt.ts`** — Builds the system prompt (static prefix for prompt caching + dynamic state suffix).
- **`tui.ts`** — Terminal UI built with `@opentui/core`. Exports `GameUI` class with a scrollable narrative panel, status bar, and input field.

### Key Design Patterns

- **Tool-driven gameplay**: The AI never fabricates game state. All actions resolve through `tool()` handlers that read/write the shared `GameContext` via `RunContext`. New mechanics must follow this pattern.
- **`RunContext<GameContext>` dependency injection**: All tools receive game state, station data, and callbacks through the Agents SDK's context mechanism — no closure-captured state.
- **`previousResponseId` chaining**: Conversation history is managed server-side. Each turn passes only the new user message plus the previous response ID.
- **Dynamic instructions**: The `Agent` uses a function for `instructions` that reads from `RunContext` to inject current game state (events, NPC hints, moral profile) as a variable suffix after the static prompt rules.
- **Combat is stateless per-round**: Enemy HP persists on the NPC object. Multi-round fights work because defeated enemies have `disposition: 'dead'`.
- **Enemy drops mutate room data**: When an enemy drops loot, the drop is tracked in `state.roomDrops` and made pickable via `pick_up_item`.

### Tech Stack

- **Runtime**: Bun (direct TypeScript execution, no compile step)
- **AI SDK**: `@openai/agents` (agent loop, tool execution, streaming, `RunContext<T>`)
- **Schema validation**: Zod v4 (tool parameter schemas)
- **ESM modules**: `"type": "module"` in package.json
- **TypeScript**: `strict: true`, `noEmit: true`, target ES2022, bundler module resolution
- **ESLint**: Flat config with `typescript-eslint` `strictTypeChecked` rules

### GPT-4.1 Prompting (System Prompt in src/prompt.ts)

GPT-4.1 follows instructions **literally** — it will not infer formatting or behavior you don't explicitly request. Key rules when editing the system prompt:

- **Use markdown headers** (`#`, `##`) to structure the system prompt. This signals to the model that markdown is the expected output language.
- **Dedicated `# Output Format` section** near the top for any response formatting rules (bold, italics, blockquotes). GPT-4.1 treats this as a first-class instruction.
- **Sandwich method**: Repeat critical instructions (especially formatting) at both the beginning and end of the prompt. GPT-4.1 prioritizes instructions near the end when there are conflicts.
- **Be explicit, not implicit**: A single firm sentence ("You MUST use markdown") is more effective than lengthy examples. Don't assume the model will infer what you want.
- **Prompt caching**: Structure dynamic instructions as static prefix (>1024 tokens, rules/format) + variable suffix (game state). Set `promptCacheRetention: '24h'` for extended caching.
- **Prompt migration risk**: Prompts written for GPT-4o may underperform on GPT-4.1 because GPT-4o inferred intent and filled gaps; GPT-4.1 does not.
