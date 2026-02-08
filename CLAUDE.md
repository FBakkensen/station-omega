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
- **`src/creative.ts`** — Creative content generation using a separate `Agent` with `outputType` (Zod structured output) + `run()` for one-shot station theming.
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

### GPT-5.2 Prompting (System Prompt in src/prompt.ts)

The Game Master uses `gpt-5.2` with `reasoning: { effort: 'none' }` — a reasoning model running without chain-of-thought, making it fast and highly steerable. Key rules when editing the system prompt:

- **Use markdown headers** (`#`, `##`) to structure the system prompt, and **XML tags** (`<station_rooms>`, `<npc_list>`) to delineate data sections from instructions.
- **Dedicated `# Output Format` section** near the top for response formatting rules. GPT-5.2 with `effort: none` relies heavily on explicit prompting.
- **Sandwich method**: Repeat critical instructions at both the beginning and end of the prompt via a `# Reminder` section.
- **Think-before-act**: Since `reasoning: none` disables internal chain-of-thought, the prompt should encourage the model to consider game state before resolving actions.
- **Preambles**: Instruct the model to write a brief atmospheric line before tool calls — this improves tool-calling accuracy and fits the narrative style.
- **Prompt caching**: Structure dynamic instructions as static prefix (>1024 tokens, rules/format) + variable suffix (game state). Set `promptCacheRetention: '24h'` for extended caching.
- **Verbosity**: The `text: { verbosity: 'low' }` API parameter enforces concise output at the model level, complementing the prompt's "2-4 sentences" instruction.
- **Compaction**: For long game sessions, consider using the Responses API `/responses/compact` endpoint to compress conversation history when approaching context limits.
