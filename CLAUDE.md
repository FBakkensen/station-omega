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

Station Omega is an AI-powered text adventure game using the GitHub Copilot SDK. Two source files:

- **`index.ts`** — All game logic: data definitions, mutable singleton `state: GameState`, five tools defined via `defineTool()` from `@github/copilot-sdk` (`look_around`, `move_to`, `pick_up_item`, `use_item`, `attack`), the system prompt, and the main loop that creates a `CopilotClient` session (GPT-4.1, streaming).
- **`tui.ts`** — Terminal UI built with `@opentui/core`. Exports `GameUI` class with a scrollable narrative panel, status bar, and input field. Streams AI response deltas into the narrative view.

### Key Design Patterns

- **Tool-driven gameplay**: The AI never fabricates game state. All actions resolve through `defineTool` handlers that read/write the shared `state` object. New mechanics must follow this pattern.
- **Combat is stateless per-round**: Enemy HP is copied from the template each attack call. Multi-round fights work because defeated enemies are tracked in `state.roomEnemyDefeated`.
- **Linear room progression**: 6 rooms in an ordered array navigated with "forward"/"back". Room 5 (Command Bridge) requires a keycard. Win condition: return to room 0 with the black box.
- **Enemy drops mutate room data**: When an enemy drops loot, the `ROOMS` array entry is temporarily replaced to make the drop pickable via `pick_up_item`.

### Tech Stack

- **Runtime**: Bun (direct TypeScript execution, no compile step)
- **ESM modules**: `"type": "module"` in package.json
- **TypeScript**: `strict: true`, `noEmit: true`, target ES2022, bundler module resolution
- **ESLint**: Flat config with `typescript-eslint` `strictTypeChecked` rules

### GPT-4.1 Prompting (System Prompt in index.ts)

GPT-4.1 follows instructions **literally** — it will not infer formatting or behavior you don't explicitly request. Key rules when editing `SYSTEM_MESSAGE`:

- **Use markdown headers** (`#`, `##`) to structure the system prompt. This signals to the model that markdown is the expected output language.
- **Dedicated `# Output Format` section** near the top for any response formatting rules (bold, italics, blockquotes). GPT-4.1 treats this as a first-class instruction.
- **Sandwich method**: Repeat critical instructions (especially formatting) at both the beginning and end of the prompt. GPT-4.1 prioritizes instructions near the end when there are conflicts.
- **Be explicit, not implicit**: A single firm sentence ("You MUST use markdown") is more effective than lengthy examples. Don't assume the model will infer what you want.
- **Prompt migration risk**: Prompts written for GPT-4o may underperform on GPT-4.1 because GPT-4o inferred intent and filled gaps; GPT-4.1 does not.
- **Free-tier models** available in Copilot SDK: `gpt-4.1` (current, 0x), `gpt-4o` (0x), `gpt-5-mini` (0x), `raptor-mini` (0x). See [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models).
