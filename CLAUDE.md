# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run start        # Run the game (bun index.ts)
bun run typecheck    # Type-check with tsc --noEmit
bun run lint         # Lint with ESLint (strict type-checked rules)
bun run deadcode     # Dead code detection with knip

# Test scripts (require OPENROUTER_API_KEY)
bun run test:fixture   # Generate a station fixture to test/fixtures/
bun run test:creative  # Test creative content generation
bun run test:gm        # Test game master responses
bun run test:analyze   # Analyze test results
```

Always run both `bun run typecheck` and `bun run lint` before considering a task complete. All errors must be resolved.

## Workflow Rules

- **Zero tolerance for warnings and errors.** All linter and type-checker output must be clean — no warnings, no errors. Fix everything, even if you believe issues were pre-existing.
- **Always run `bun run typecheck && bun run lint` before returning to the user.** No exceptions.
- **Always run interactive tests using the Chrome MCP.** Use the browser automation tools to verify UI changes and game behavior in the running app.
- **Always handle the full flow.** Start the dev server, update Convex (`npx convex dev`), and ensure the full stack is running before testing.
- **Use a pre-generated station when testing**, unless the task specifically involves testing station generation. This avoids slow generation waits during iterative testing.
- **Disable sounds when testing**, unless the task specifically involves testing sound/TTS integration. This avoids audio issues in automated testing.

## Architecture

Station Omega is an AI-powered text adventure game using the **Vercel AI SDK** (`ai` v6) with **OpenRouter** (`@openrouter/ai-sdk-provider`) for multi-model access. The player navigates a procedurally generated derelict space station, repairing systems, collecting items, interacting with NPCs, and completing objectives to escape.

Two interfaces exist: a **terminal TUI** (the original, `index.ts` + `tui.ts`) and a **web client** (`web/`) backed by a **Convex** serverless backend (`convex/`).

### Source Files — TUI Game

- **`index.ts`** — Main game loop: `streamText()` with client-side `ModelMessage[]` conversation history, per-turn system context messages, inline guardrail validation, and `fullStream` iteration. Manages TTS, UI, event tracking, player input, and turn snapshots for rollback on error.
- **`tui.ts`** — Terminal UI built with `@opentui/core`. `GameUI` class with scrollable narrative panel, per-segment card rendering, status bar, character selection, station picker, run history display, and slash commands.
- **`src/agents.ts`** — Exports `GameMasterConfig` interface and `createGameMasterConfig()` factory. Combines model, system prompt, and tool set. No multi-agent handoffs — single GM agent per turn.
- **`src/models.ts`** — Centralized model configuration. Uses `createOpenRouter()` to define `gameMasterModel` (`google/gemini-3-flash-preview`) and `creativeModel` (`anthropic/claude-opus-4.6`). Model swaps are a one-line string change.
- **`src/tools.ts`** — All 19 game tools defined via `tool()` from `ai` with Zod schemas. Tools access shared `GameContext` via closure capture in `createGameToolSets()`. Defines `GameContext`, `ChoiceSet`, and `GameToolSets` types.
- **`src/prompt.ts`** — Builds the static system prompt via `buildOrchestratorPrompt()` plus shared section helpers (`buildOutputFormatRules()`, `buildCharacterSection()`, `buildRoomList()`, `formatNpcList()`). Dynamic state is passed per-turn via system-role messages.
- **`src/schema.ts`** — Zod schema for structured JSON output. `GameSegmentSchema` (6 types: narration, dialogue, thought, station_pa, crew_echo, diagnostic_readout), `GameResponseSchema`, `DisplaySegment` (with resolved `speakerName`, `segmentIndex`, `missionTime`).
- **`src/types.ts`** — All TypeScript types: `GameState`, `GeneratedStation`, `NPC`, `Room`, `Item`, `SystemFailure`, `CharacterBuild`, `ActionDomain`, `Disposition` (neutral/friendly/fearful), `RunMetrics`, moral choices, scoring, events.
- **`src/turn-context.ts`** — `buildTurnContext()`: assembles dynamic per-turn system message from game state (mission elapsed time, active events, NPC allies, moral profile, player condition, environment readings).
- **`src/validation.ts`** — `validateGameResponse()`: post-stream guardrails checking NPC IDs exist and are in current room, crew names are valid. `validateStateConsistency()` clamps out-of-bounds values. `buildGuardrailFeedback()` constructs corrective system messages.
- **`src/environment.ts`** — `EnvironmentSnapshot` (O2%, CO2ppm, pressure, temp, radiation, structural integrity, gravity, power) computed per-room from system failures and active events. `EnvironmentTracker` updates per turn.
- **`src/events.ts`** — Random event system: `EventTracker` manages cooldowns/triggers. 7 event types (hull_breach, power_failure, atmosphere_alarm, radiation_spike, coolant_leak, distress_signal, supply_cache). `getEventContext()` serializes active events for the prompt.
- **`src/character.ts`** — Character class logic: `getProficiencyModifier()` (±15), `initializePlayerState()`. 4 builds: engineer, scientist, medic, commander.
- **`src/data.ts`** — Static game data: `CHARACTER_BUILDS`, `STARTING_ITEMS`, `ENGINEERING_ITEMS` catalog (50+ items), `CRAFT_RECIPES`, difficulty modifiers, room archetypes.
- **`src/scoring.ts`** — `computeScore()` with 5 categories (speed, engineering efficiency, exploration, resourcefulness, completion). Grades S through F. `saveRunToHistory()`/`loadRunHistory()` persist to `run-history.json`.
- **`src/env.ts`** — API key management: checks/sets `OPENROUTER_API_KEY`, persists to `.env.local`.

### Source Files — Rendering & Audio

- **`src/json-stream-parser.ts`** — `StreamingSegmentParser`: extracts complete `GameSegment` objects from incremental JSON deltas using brace-depth tracking. O(n) across all deltas.
- **`src/segment-style.ts`** — Pre-styled `TextChunk[]` generation: `segmentToStyledChunks()` parses markdown once via `flattenMarkdown()`, maps to styled chunks. `truncateChunks()` for typewriter reveal. `segmentCardStyle()` for per-type card borders/colors.
- **`src/markdown-reveal.ts`** — Markdown-to-`ContentRun[]` flattening via `marked` Lexer. `flattenMarkdown()` produces inline format runs (bold, italic, code, strikethrough). `extractCleanText()` strips markdown for TTS input.
- **`src/map-layout.ts`** — Force-directed layout algorithm: converts room graph into `MapLayout` (x/y coordinates per room).
- **`src/map-render.ts`** — Renders `MapLayout` to styled `TextChunk[]` for TUI display with archetype icons, connection lines, visited/current room highlighting.
- **`src/tts.ts`** — TTS engine using Inworld TTS-1.5-max API (`api.inworld.ai/tts/v1/voice:stream`) with NDJSON streaming. Concurrent generation/playback pumps with AbortController cancellation.
- **`src/audio-player.ts`** — PvSpeaker wrapper for PCM audio playback with graceful fallback if native module unavailable.

### Source Files — Station Generation

- **`src/generation/index.ts`** — Orchestrator: runs 4 layers sequentially via `generateStation()`. Layer 2 is deterministic; Layer 4 runs parallel sub-layers. Produces `StationSkeleton` + `CreativeContent`.
- **`src/generation/layer-runner.ts`** — Generic execution engine: `runLayer()` handles prompt → `streamText()` with `Output.object()` → validation → retry with error feedback. Fibonacci backoff for API errors (up to 10 retries). `LayerContext` accumulates validated output.
- **`src/generation/validate.ts`** — Shared generation validators: connectivity checks, bidirectional edges, room existence, material reachability.
- **`src/generation/concurrency.ts`** — Concurrency utilities for parallel sub-layer execution.
- **`src/generation/layers/topology.ts`** — Layer 1: AI generates room graph (IDs, archetypes, connections, locked doors, entry/escape, scenario theme).
- **`src/generation/layers/systems-items-procedural.ts`** — Layer 2: Deterministic procedural placement of system failures and engineering materials/tools across rooms (no AI call).
- **`src/generation/layers/systems-items.ts`** — Layer 2 output type definition (shared by downstream layers).
- **`src/generation/layers/objectives-npcs.ts`** — Layer 3: AI designs objective chain and NPC placement given topology + systems.
- **`src/generation/layers/creative.ts`** — Layer 4 coordinator: runs parallel sub-layers and merges results into `CreativeContent`.
- **`src/generation/layers/creative-rooms.ts`** — Sub-layer: room names, descriptions, sensory details, crew logs.
- **`src/generation/layers/creative-npcs.ts`** — Sub-layer: NPC names, personalities, sound signatures, dialogue style.
- **`src/generation/layers/creative-items.ts`** — Sub-layer: item names and descriptions.
- **`src/generation/layers/creative-arrival.ts`** — Sub-layer: arrival scenario narrative.
- **`src/generation/layers/creative-identity.ts`** — Sub-layer: station name and identity.
- **`src/assembly.ts`** — Merges `StationSkeleton` + `CreativeContent` into final `GeneratedStation` with `Map<string, Room/NPC/Item>`.
- **`src/station-storage.ts`** — Save/load/list/delete `GeneratedStation` to disk as JSON with Map/Set serialization.

### Source Files — Utilities

- **`src/graph.ts`** — Room graph utilities: `getAdjacentRooms()`, `bfsPath()` (BFS shortest path).
- **`src/generation-log.ts`** — Per-station generation logging.

### Web Client & Backend

- **`web/`** — React/TypeScript web client (Vite). Screens: TitleScreen, CharacterSelectScreen, StationPickerScreen, GameplayScreen, LoadingScreen, GameOverScreen, RunSummaryScreen, RunHistoryScreen. Components organized into `narrative/`, `sidebar/`, `input/`, `modals/` directories.
- **`convex/`** — Convex serverless backend. Tables: games, stations, messages, turns, turnSegments, turnLocks, choiceSets, runHistory, generationProgress. Handles station generation, turn processing, and game state persistence.

### Test Files

- **`test/generate-fixture.ts`** — Generate a station fixture to `test/fixtures/`.
- **`test/test-creative.ts`** — Test creative content generation layer.
- **`test/test-gamemaster.ts`** — Test GM responses against fixture stations.
- **`test/analyze-results.ts`** — Analyze test output quality.
- **`test/model-config.ts`** — Shared model configuration for tests.
- **`voice-test.ts`** — Standalone A/B test for TTS voices, generates WAVs + spectrograms to `voice-tests/`.

## Station Generation Pipeline

Station creation uses a 4-layer pipeline (`src/generation/`) plus assembly:

1. **Topology** (`layers/topology.ts`) — AI generates room graph: room IDs, archetypes, connections, locked doors, entry/escape rooms, and scenario theme.
2. **Systems & Items** (`layers/systems-items-procedural.ts`) — Deterministic procedural placement of system failures and engineering materials. No AI call. Validated against topology.
3. **Objectives & NPCs** (`layers/objectives-npcs.ts`) — AI designs the objective chain and NPC placement. Receives validated topology + systems as context.
4. **Creative** (`layers/creative.ts`) — AI generates names, descriptions, sensory details, crew logs, arrival scenario, and NPC creative content via 5 parallel sub-layers.
5. **Assembly** (`src/assembly.ts`) — Merges `StationSkeleton` (from layers 1-3) + `CreativeContent` (layer 4) into the final `GeneratedStation`.

Each AI layer uses `runLayer()` (`layer-runner.ts`) which handles: prompt building → `streamText()` with `Output.object()` → validation → retry with error feedback. Fibonacci backoff for API errors. Layers pass validated output forward via `LayerContext`.

## Streaming & Rendering Pipeline

Each player turn flows through:

1. **Model streaming** — `streamText()` with `output: Output.object({ schema })` yields `text-delta` events via `result.fullStream` containing incremental JSON.
2. **Segment extraction** — `StreamingSegmentParser` tracks brace depth to extract complete `GameSegment` objects as soon as they close.
3. **Segment resolution** — `resolveSegment()` in `index.ts` looks up NPC/crew names, adds `speakerName` and `segmentIndex` to create `DisplaySegment`.
4. **Styled chunks** — `segmentToStyledChunks()` parses markdown once via `flattenMarkdown()`, maps content runs to styled `TextChunk[]`.
5. **Card creation** — Each segment becomes its own `BoxRenderable` card in the TUI with typed header and pre-styled content.
6. **Typewriter reveal** — `truncateChunks()` slices `TextChunk[]` by character count. TTS `onRevealChunk()` routes timing to the correct card via `segmentIndex`.
7. **TTS** — Segments are pushed to the TTS engine which generates speech chunks concurrently, with voice selection based on segment type and NPC identity.

## Key Design Patterns

- **Tool-driven gameplay**: The AI never fabricates game state. All actions resolve through `tool()` handlers that read/write the shared `GameContext` via closure capture. New mechanics must follow this pattern.
- **Closure-captured context**: All tools access `GameContext` via closure in `createGameToolSets()`. The `gameCtx` object is created once and mutated in place.
- **Client-side conversation history**: A `ModelMessage[]` array accumulates full conversation. Sent each turn via `streamText({ messages })`. Typically 15-30k tokens for a full game session.
- **Instructions/Context separation**: System prompt is a static string (from `buildOrchestratorPrompt()`). Dynamic game state is passed as system-role messages in the messages array each turn, making the AI treat it as context to interpret rather than rules to follow.
- **Per-segment card UI**: Each AI segment becomes its own `BoxRenderable` card with typed speaker header and pre-styled `TextChunk[]`. `SegmentCardState` in `tui.ts` tracks per-card typewriter reveal progress.

## AI-as-Game-Master Principle

This game uses an AI narrator — the design should leverage that, not fight it.

- **Tools are primitives.** HP, dice rolls, inventory, room adjacency, locks, `revealedItems` gating, environment readings. Tools return raw mechanical data — never narrative strings.
- **The AI is the game master.** It interprets tool results and game state to generate the experience. Tools report what happened; the AI tells the story.
- **Instructions vs Context.** System prompt = static game rules. Dynamic state (events, NPC hints, moral profile) = system-role message in the messages array each turn. Rules are rules; state is context to interpret.
- **Events are conditions, not scripts.** A power failure means the AI shifts to non-visual narration — not that tools strip data.
- **NPC behaviors are tendencies.** Flags like `can_flee` indicate capability. The AI decides when and how they manifest.
- **Output guardrails verify, not narrate.** `validateGameResponse()` in `src/validation.ts` checks AI output after stream completes — pure TypeScript checks, no extra LLM call.

When adding mechanics: "Is this physics (tool) or narration (AI)?" Dice rolls, HP, state transitions = tool. How it looks, sounds, feels = AI.

## Tech Stack

- **Runtime**: Bun (direct TypeScript execution, no compile step)
- **AI SDK**: `ai` v6 (Vercel AI SDK — `streamText`, `tool`, `Output.object`, `stepCountIs`) + `@openrouter/ai-sdk-provider` (300+ model access via OpenRouter)
- **Schema validation**: Zod v4 (tool parameter schemas + structured output)
- **Markdown parsing**: `marked` v17 Lexer (for inline format extraction in `markdown-reveal.ts`)
- **TUI**: `@opentui/core` (Box/Text/Input renderables, `StyledText`, `TextChunk`)
- **Audio**: `@picovoice/pvspeaker-node` (native PCM playback with graceful fallback)
- **TTS**: Inworld TTS-1.5-max API (48kHz/16-bit/mono, NDJSON streaming, 20+ voice pool)
- **Web client**: React + TypeScript + Vite
- **Backend**: Convex (serverless, real-time sync)
- **ESM modules**: `"type": "module"` in package.json
- **TypeScript**: `strict: true`, `noEmit: true`, `noUnusedLocals`, `noUnusedParameters`, target ES2022, bundler module resolution
- **ESLint**: Flat config with `typescript-eslint` `strictTypeChecked` rules

## AI SDK Gotchas

- `tool()` `execute` can be sync or async (`PromiseLike<OUTPUT> | OUTPUT`) — omit `async` when no awaits (ESLint `require-await`).
- `tool()` uses `inputSchema:` (not `parameters:`). Tool name is the key in the `ToolSet` record, not a property.
- `streamText()` `fullStream` events: `text-delta` has `.text`, `tool-call` has `.input` (not `.args`), `tool-result` has `.output` (not `.result`).
- `Output.object({ schema })` enforces JSON schema at the API level AND provides structured `result.output`. `result.output` is always truthy — no null check needed.
- `stepCountIs(n)` counts tool-calling steps. Structured output counts as an extra step, so use `n+1` for `n` tool rounds.
- Use `ToolSet` type for records of tools, `ToolSet[string]` for individual tool variables. `ModelMessage` for conversation messages.

## ESLint Gotchas (strictTypeChecked)

- `require-await`: `tool()` `execute` can be sync — omit `async` when no awaits needed.
- `no-unnecessary-type-conversion`: Don't wrap already-typed strings in `String()`.
- `no-unnecessary-condition`: Array index access without `noUncheckedIndexedAccess` returns `T` not `T|undefined` — use bounds check instead of nullish guard.

## System Prompt Guidelines (src/prompt.ts)

The Game Master model is configurable via `src/models.ts` (current: `google/gemini-3-flash-preview` for GM, `anthropic/claude-opus-4.6` for creative generation). Key rules when editing the system prompt:

- **Use markdown headers** (`#`, `##`) to structure the system prompt, and **XML tags** (`<station_rooms>`, `<npc_list>`) to delineate data sections from instructions.
- **Dedicated `# Output Format` section** near the top for response formatting rules.
- **Sandwich method**: Repeat critical instructions at both the beginning and end of the prompt via a `# Reminder` section.
- **Think-before-act**: The prompt should encourage the model to consider game state before resolving actions.
- **Preambles**: Instruct the model to write a brief atmospheric line before tool calls — this improves tool-calling accuracy and fits the narrative style.
- **Model switching**: Change model by editing the string in `src/models.ts`. All OpenRouter-supported models work (Claude, Gemini, GPT, DeepSeek, Mistral, etc.). Target models that support `json_schema` structured output.
