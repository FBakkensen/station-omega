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

Station Omega is an AI-powered text adventure game using the OpenAI Agents SDK (`@openai/agents`). The player navigates a procedurally generated derelict space station, fighting enemies, collecting items, interacting with NPCs, and completing objectives to escape.

### Source Files

- **`index.ts`** — Main game loop: creates an `Agent<GameContext>` with dynamic instructions, `previousResponseId` chaining, and streaming via `run()`. Manages TTS, UI, event tracking, and player input.
- **`tui.ts`** — Terminal UI built with `@opentui/core`. Exports `GameUI` class with a scrollable narrative panel, per-segment card rendering, status bar, character selection, and input field.
- **`src/tools.ts`** — All 16 game tools defined via `tool()` from `@openai/agents` with Zod schemas. Tools access shared state through `RunContext<GameContext>` dependency injection. Defines `GameContext` and `ChoiceSet` types.
- **`src/prompt.ts`** — Builds the system prompt: static prefix (>1024 tokens for prompt caching) + dynamic state suffix injected per turn.
- **`src/schema.ts`** — Zod schema for structured JSON output (`GameResponseSchema`). Defines `GameSegment` (5 types: narration, dialogue, thought, station_pa, crew_echo), `DisplaySegment` (with resolved speaker name + index), and `segmentToMarkdown()`.
- **`src/types.ts`** — All TypeScript types: game state, station structure, NPC/item/room models, character builds, moral choices, scoring, events.
- **`src/skeleton.ts`** — Phase 1 of station generation: deterministic room graph, items, enemies, and objectives using a seeded PRNG (LCG). Pure TypeScript, no AI calls.
- **`src/creative.ts`** — Phase 2: AI-powered creative content generation using a separate `Agent` with `outputType` (Zod structured output). Generates names, descriptions, sensory details, crew logs.
- **`src/assembly.ts`** — Phase 3: merges skeleton + creative content into a final `GeneratedStation` with `Map<string, Room/NPC/Item>`.
- **`src/data.ts`** — Static game data: character builds, difficulty multipliers/targets, starting items, room archetypes, disposition configs.
- **`src/character.ts`** — Character class logic: proficiency/weakness modifiers, `initializePlayerState()`, re-exports `CHARACTER_BUILDS`.
- **`src/events.ts`** — Random event system: `EventTracker` manages cooldowns/triggers, `getEventContext()` serializes active events for the prompt.
- **`src/scoring.ts`** — End-of-run scoring: `computeScore()` calculates 5 category scores + grade, `saveRunToHistory()`/`loadRunHistory()` persist to `run-history.json`.
- **`src/graph.ts`** — Room graph utilities: `getAdjacentRooms()`, `bfsPath()` (BFS shortest path).
- **`src/json-stream-parser.ts`** — `StreamingSegmentParser`: extracts complete `GameSegment` objects from incremental JSON deltas using brace-depth tracking. O(n) across all deltas.
- **`src/segment-style.ts`** — Pre-styled `TextChunk[]` generation: `segmentToStyledChunks()` parses markdown once via `flattenMarkdown()`, maps to styled chunks. `truncateChunks()` for typewriter reveal. `segmentCardStyle()` for per-type card borders/colors.
- **`src/markdown-reveal.ts`** — Markdown-to-`ContentRun[]` flattening via `marked` Lexer. Produces inline format runs (bold, italic, code, strikethrough) consumed by `segment-style.ts`.
- **`src/tts.ts`** — TTS engine: OpenAI gpt-4o-mini-tts with instruction-based voice steering. Concurrent generation/playback pumps with AbortController cancellation. 13 voices hash-selected by NPC ID.

### Station Generation Pipeline

Station creation is a 3-phase pipeline:

1. **Skeleton** (`src/skeleton.ts`) — Seeded PRNG generates deterministic room graph, enemy placement, item distribution, objective chain, and locked-door dependencies. No AI calls.
2. **Creative** (`src/creative.ts`) — A separate Agent with structured `outputType` generates thematic names, descriptions, sensory details, crew logs, and backstory. IDs must match the skeleton.
3. **Assembly** (`src/assembly.ts`) — Merges skeleton structure + creative content into the final `GeneratedStation` used during gameplay (Maps of rooms, NPCs, items).

### Streaming & Rendering Pipeline

Each player turn flows through:

1. **Agent streaming** — `run(agent, prompt, { stream: true })` yields `raw_model_stream_event` with `output_text_delta` containing incremental JSON.
2. **Segment extraction** — `StreamingSegmentParser` tracks brace depth to extract complete `GameSegment` objects as soon as they close.
3. **Segment resolution** — `resolveSegment()` in `index.ts` looks up NPC/crew names, adds `speakerName` and `segmentIndex` to create `DisplaySegment`.
4. **Styled chunks** — `segmentToStyledChunks()` parses markdown once via `flattenMarkdown()`, maps content runs to styled `TextChunk[]`.
5. **Card creation** — Each segment becomes its own `BoxRenderable` card in the TUI with typed header and pre-styled content.
6. **Typewriter reveal** — `truncateChunks()` slices `TextChunk[]` by character count. TTS `onRevealChunk()` routes timing to the correct card.
7. **TTS** — Segments are pushed to the TTS engine which generates speech chunks concurrently, with voice selection based on segment type and NPC identity.

### Key Design Patterns

- **Tool-driven gameplay**: The AI never fabricates game state. All actions resolve through `tool()` handlers that read/write the shared `GameContext` via `RunContext`. New mechanics must follow this pattern.
- **`RunContext<GameContext>` dependency injection**: All tools receive game state, station data, and callbacks through the Agents SDK's context mechanism — no closure-captured state. Use the `getCtx()` guard helper instead of non-null assertions.
- **`previousResponseId` chaining**: Conversation history is managed server-side. Each turn passes only the new user message plus the previous response ID.
- **Dynamic instructions**: The `Agent` uses a function for `instructions` that reads from `RunContext` to inject current game state (events, NPC hints, moral profile) as a variable suffix after the static prompt rules.
- **Combat is stateless per-round**: Enemy HP persists on the NPC object. Multi-round fights work because defeated enemies have `disposition: 'dead'`.
- **Enemy drops mutate room data**: When an enemy drops loot, the drop is tracked in `state.roomDrops` and made pickable via `pick_up_item`.

### Tech Stack

- **Runtime**: Bun (direct TypeScript execution, no compile step)
- **AI SDK**: `@openai/agents` (agent loop, tool execution, streaming, `RunContext<T>`)
- **Schema validation**: Zod v4 (tool parameter schemas + structured output)
- **Markdown parsing**: `marked` Lexer (for inline format extraction in `markdown-reveal.ts`)
- **TUI**: `@opentui/core` (Box/Text/Input renderables, `StyledText`, `TextChunk`)
- **ESM modules**: `"type": "module"` in package.json
- **TypeScript**: `strict: true`, `noEmit: true`, target ES2022, bundler module resolution
- **ESLint**: Flat config with `typescript-eslint` `strictTypeChecked` rules

### Agents SDK Gotchas

- `Agent<GameContext, typeof Schema>` — MUST pass second generic for `outputType` Zod schemas. Default is `TextOutput` which locks `outputType` to `"text"`.
- `tool()` `execute` returns `string | Promise<string>` — sync is fine, omit `async` when no awaits (ESLint `require-await`).
- Agent events: `agent_tool_end` signature is `(context, tool, result)` — NOT `(context, agent, tool, result)`.
- Use `Tool<GameContext>` (union type) for tool arrays, not `FunctionTool<GameContext>`.

### ESLint Gotchas (strictTypeChecked)

- `no-non-null-assertion`: Use the `getCtx()` guard helper instead of `ctx!.context`.
- `require-await`: SDK `execute` can be sync — omit `async` when no awaits needed.
- `no-unnecessary-type-conversion`: Don't wrap already-typed strings in `String()`.
- `no-unnecessary-condition`: Array index access without `noUncheckedIndexedAccess` returns `T` not `T|undefined` — use bounds check instead of nullish guard.

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
