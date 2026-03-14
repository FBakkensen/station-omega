# Project Guidelines

`AGENTS.md` is the single source of truth for repository-level coding instructions in Station Omega. Keep this file current and avoid maintaining parallel instruction files with overlapping guidance.

## Architecture
- Station Omega has three code zones: `src/` for the shared game engine and generation pipeline, `convex/` for persistence and server actions, and `web/` for the React client.
- Preserve the tool-driven gameplay boundary: mechanics and state transitions live in shared engine and tool code, while prose behavior lives in prompt and model layers.
- Start from these entry points when tracing behavior:
  - `src/tools.ts` for gameplay mechanics.
  - `src/prompt.ts` and `src/turn-context.ts` for narrator and game-master behavior.
  - `src/generation/index.ts` for station generation orchestration.
  - `convex/actions/streamTurn.ts` for turn execution and streaming.
  - `convex/lib/serialization.ts` for Convex persistence round-trips.
  - `web/src/App.tsx` and `web/README.md` for frontend flow and responsibilities.

## Build And Test
- `bun install` installs root dependencies.
- `bun run dev` starts Convex and the web app together.
- `bun run dev:convex` and `bun run dev:web` start each side independently.
- `bun run check` is the canonical QA gate and must pass before returning code changes.
- `bun run check:static` runs typecheck, lint, dead-code, and web static checks.
- `bun run check:tests` runs deterministic tests plus web tests.
- `bun run test:fixture`, `bun run test:creative`, and `bun run test:gm` are required follow-up checks when generation, prompt, or game-master behavior changes.
- `bun run pw -- <command>` runs the repo-local Playwright CLI for gameplay smoke coverage.

## Conventions
- Prefer shared types and schema-first interfaces from `src/` over local duplicate types.
- `tool()` handlers can stay synchronous when they do not need `await`.
- Convex persistence stores plain objects only. When working with station or game state, use `convex/lib/serialization.ts` to convert Maps and Sets to Convex-safe data and back.
- Deterministic tests run under a no-network harness. Do not add direct `fetch`, `node:http`, `node:https`, `node:net`, or `node:tls` usage outside the explicit allowlist in `eslint.config.js`.
- Keep `convex/_generated/` untouched; it is generated code.

## Debugging
- When debugging issues, ALWAYS read actual logs, error messages, and docs BEFORE guessing at causes. Do not speculate or hypothesize without evidence.
- Never dismiss diagnostic errors, test failures, or UI issues as "stale" or "pre-existing" without verification. Always investigate when the user reports something is wrong.

## Pitfalls
- Convex actions may need dynamic `await import()` when loading modules from `src/`. Follow the pattern in `convex/actions/streamTurn.ts` instead of converting those imports to static top-level imports.
- The web app is a separate Vite workspace. Do not assume `web/src/` can import arbitrary files from the repo root; rely on its local code and generated Convex bindings unless the Vite config is updated.
- React runs in `StrictMode` in development. Keep render paths and state updaters free of side effects.
- Run Playwright commands sequentially. Parallel Playwright invocations can fail because of Bun cache and extraction races.

## Testing Notes
- Every deterministic `it(...)` or `test(...)` title must start with exactly one ZOMBIES prefix: `[Z]`, `[O]`, `[M]`, `[B]`, `[I]`, `[E]`, or `[S]`.
- Every `describe(...)` block must include all seven ZOMBIES principles at least once.
- Use `http://localhost:5173/?devfast=1` for manual and Playwright gameplay smoke tests.

## Docs
- Use `web/README.md` for frontend-specific responsibilities and commands.
- Do not rely on `convex/README.md` for repo guidance; it is still the default Convex boilerplate.

## Pull Requests
- Follow the existing concise imperative commit style.
- PRs should include a short behavior summary, commands run, gameplay impact, and any prompt or agent behavior changes.

## Security
- Never commit `.env.local`, API keys, or personal run artifacts.
- Keep required secrets such as `OPENAI_API_KEY` and `INWORLD_API_KEY` local.
