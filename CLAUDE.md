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

Station Omega is an AI-powered text adventure game using the Vercel AI SDK (`ai`) with OpenRouter (`@openrouter/ai-sdk-provider`) for multi-model access. The player navigates a procedurally generated derelict space station, fighting enemies, collecting items, interacting with NPCs, and completing objectives to escape.

### Source Files

- **`index.ts`** — Main game loop: uses `streamText()` with client-side `ModelMessage[]` conversation history, per-turn system context messages, inline guardrail validation, and `fullStream` iteration. Manages TTS, UI, event tracking, and player input.
- **`tui.ts`** — Terminal UI built with `@opentui/core`. Exports `GameUI` class with a scrollable narrative panel, per-segment card rendering, status bar, character selection, and input field.
- **`src/tools.ts`** — All 21 game tools defined via `tool()` from `ai` with Zod schemas. Tools access shared `GameContext` via closure capture in a factory function `createGameToolSets()`. Defines `GameContext` and `ChoiceSet` types.
- **`src/prompt.ts`** — Builds the static system prompt. Dynamic state is passed per-turn via system-role messages in the messages array.
- **`src/models.ts`** — Centralized model configuration. Uses `createOpenRouter()` to define `gameMasterModel` and `creativeModel`. Model swaps are a one-line string change.
- **`src/agents.ts`** — Exports `GameMasterConfig` interface and `createGameMasterConfig()` factory. Combines model, system prompt, and tool set.
- **`src/schema.ts`** — Zod schema for structured JSON output (`GameResponseSchema`). Defines `GameSegment` (5 types: narration, dialogue, thought, station_pa, crew_echo), `DisplaySegment` (with resolved speaker name + index), and `segmentToMarkdown()`.
- **`src/types.ts`** — All TypeScript types: game state, station structure, NPC/item/room models, character builds, moral choices, scoring, events.
- **`src/skeleton.ts`** — Phase 1 of station generation: deterministic room graph, items, enemies, and objectives using a seeded PRNG (LCG). Pure TypeScript, no AI calls.
- **`src/creative.ts`** — Phase 2: AI-powered creative content generation using `streamText()` with `Output.object()` (Zod structured output). Generates names, descriptions, sensory details, crew logs.
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
2. **Creative** (`src/creative.ts`) — `streamText()` with `Output.object()` generates thematic names, descriptions, sensory details, crew logs, and backstory. IDs must match the skeleton.
3. **Assembly** (`src/assembly.ts`) — Merges skeleton structure + creative content into the final `GeneratedStation` used during gameplay (Maps of rooms, NPCs, items).

### Streaming & Rendering Pipeline

Each player turn flows through:

1. **Model streaming** — `streamText()` with `output: Output.object({ schema })` yields `text-delta` events via `result.fullStream` containing incremental JSON.
2. **Segment extraction** — `StreamingSegmentParser` tracks brace depth to extract complete `GameSegment` objects as soon as they close.
3. **Segment resolution** — `resolveSegment()` in `index.ts` looks up NPC/crew names, adds `speakerName` and `segmentIndex` to create `DisplaySegment`.
4. **Styled chunks** — `segmentToStyledChunks()` parses markdown once via `flattenMarkdown()`, maps content runs to styled `TextChunk[]`.
5. **Card creation** — Each segment becomes its own `BoxRenderable` card in the TUI with typed header and pre-styled content.
6. **Typewriter reveal** — `truncateChunks()` slices `TextChunk[]` by character count. TTS `onRevealChunk()` routes timing to the correct card.
7. **TTS** — Segments are pushed to the TTS engine which generates speech chunks concurrently, with voice selection based on segment type and NPC identity.

### Key Design Patterns

- **Tool-driven gameplay**: The AI never fabricates game state. All actions resolve through `tool()` handlers that read/write the shared `GameContext` via closure capture. New mechanics must follow this pattern.
- **Closure-captured context**: All tools access `GameContext` via closure in the `createGameToolSets()` factory. The `gameCtx` object is created once and mutated in place.
- **Client-side conversation history**: A `ModelMessage[]` array accumulates full conversation. Sent each turn via `streamText({ messages })`. Typically 15-30k tokens for a full game session.
- **Instructions/Context separation**: System prompt is a static string (from `buildOrchestratorPrompt()`). Dynamic game state is passed as system-role messages in the messages array each turn, making the AI treat it as context to interpret rather than rules to follow.
- **Combat is stateless per-round**: Enemy HP persists on the NPC object. Multi-round fights work because defeated enemies have `disposition: 'dead'`.
- **Enemy drops mutate room data**: When an enemy drops loot, the drop is tracked in `state.roomDrops` and made pickable via `pick_up_item`.

### AI-as-Game-Master Principle

This game uses an AI narrator — the design should leverage that, not fight it.

- **Tools are primitives.** HP, damage, dice rolls, inventory, room adjacency, locks, `revealedItems` gating. Tools return raw mechanical data — never narrative strings.
- **The AI is the game master.** It interprets tool results and game state to generate the experience. Tools report what happened; the AI tells the story.
- **Instructions vs Context.** System prompt = static game rules. Dynamic state (events, NPC hints, moral profile) = system-role message in the messages array each turn. Rules are rules; state is context to interpret.
- **Events are conditions, not scripts.** A power failure means the AI shifts to non-visual narration — not that tools strip data.
- **NPC behaviors are tendencies.** Flags like `can_flee` indicate capability. The AI decides when and how they manifest.
- **Output guardrails verify, not narrate.** The game engine validates AI output against rules (valid NPC IDs, crew names) via inline `validateGameResponse()` after stream completes — pure TypeScript checks, no extra LLM call.

When adding mechanics: "Is this physics (tool) or narration (AI)?" Dice rolls, HP, state transitions = tool. How it looks, sounds, feels = AI.

### Tech Stack

- **Runtime**: Bun (direct TypeScript execution, no compile step)
- **AI SDK**: `ai` v6 (Vercel AI SDK — `streamText`, `tool`, `Output.object`, `stepCountIs`) + `@openrouter/ai-sdk-provider` (300+ model access via OpenRouter)
- **Schema validation**: Zod v4 (tool parameter schemas + structured output)
- **Markdown parsing**: `marked` Lexer (for inline format extraction in `markdown-reveal.ts`)
- **TUI**: `@opentui/core` (Box/Text/Input renderables, `StyledText`, `TextChunk`)
- **ESM modules**: `"type": "module"` in package.json
- **TypeScript**: `strict: true`, `noEmit: true`, target ES2022, bundler module resolution
- **ESLint**: Flat config with `typescript-eslint` `strictTypeChecked` rules

### AI SDK Gotchas

- `tool()` `execute` can be sync or async (`PromiseLike<OUTPUT> | OUTPUT`) — omit `async` when no awaits (ESLint `require-await`).
- `tool()` uses `inputSchema:` (not `parameters:`). Tool name is the key in the `ToolSet` record, not a property.
- `streamText()` `fullStream` events: `text-delta` has `.text`, `tool-call` has `.input` (not `.args`), `tool-result` has `.output` (not `.result`).
- `Output.object({ schema })` enforces JSON schema at the API level AND provides structured `result.output`. `result.output` is always truthy — no null check needed.
- `stepCountIs(n)` counts tool-calling steps. Structured output counts as an extra step, so use `n+1` for `n` tool rounds.
- Use `ToolSet` type for records of tools, `ToolSet[string]` for individual tool variables. `ModelMessage` for conversation messages.

### ESLint Gotchas (strictTypeChecked)

- `require-await`: `tool()` `execute` can be sync — omit `async` when no awaits needed.
- `no-unnecessary-type-conversion`: Don't wrap already-typed strings in `String()`.
- `no-unnecessary-condition`: Array index access without `noUncheckedIndexedAccess` returns `T` not `T|undefined` — use bounds check instead of nullish guard.

### System Prompt Guidelines (src/prompt.ts)

The Game Master model is configurable via `src/models.ts` (default: `anthropic/claude-sonnet-4` via OpenRouter). Key rules when editing the system prompt:

- **Use markdown headers** (`#`, `##`) to structure the system prompt, and **XML tags** (`<station_rooms>`, `<npc_list>`) to delineate data sections from instructions.
- **Dedicated `# Output Format` section** near the top for response formatting rules.
- **Sandwich method**: Repeat critical instructions at both the beginning and end of the prompt via a `# Reminder` section.
- **Think-before-act**: The prompt should encourage the model to consider game state before resolving actions.
- **Preambles**: Instruct the model to write a brief atmospheric line before tool calls — this improves tool-calling accuracy and fits the narrative style.
- **Model switching**: Change model by editing the string in `src/models.ts`. All OpenRouter-supported models work (Claude, Gemini, GPT, DeepSeek, Mistral, etc.). Target models that support `json_schema` structured output.
