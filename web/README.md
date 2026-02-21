# Station Omega Web Client

React + TypeScript + Vite frontend for Station Omega.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun run lint
bun run build
bun run preview
```

## Responsibilities

- Render streamed narrative segments and choices.
- Display player status, systems, hazards, and mission progress.
- Coordinate turn flow with Convex actions and persisted game state.
- Handle client-side UX features (typewriter reveal, keyboard shortcuts, preferences, web audio TTS playback).

## Related directories

- `web/src/screens`: top-level app states and page flow.
- `web/src/components`: narrative cards, sidebar panels, modals, and inputs.
- `web/src/hooks`: gameplay orchestration and UI behavior hooks.
- `web/src/engine`: segment parsing, scoring, and rendering helpers.
