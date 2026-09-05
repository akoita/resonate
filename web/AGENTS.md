# Resonate Web — UI and User Guide Standards

> Loaded when working under `web/`. Project-wide rules live in the root
> `AGENTS.md`.

## Browser configuration

- Only values safe to expose to browsers may use the `NEXT_PUBLIC_` prefix.
- Import shared API/configuration constants from their canonical module; do not
  redeclare environment-derived URLs in individual components.

## User-visible changes

When a change materially adds, changes, exposes, hides, or removes something a
listener, artist, producer, curator, or operator can see or do, update the
matching `/help` article in `src/lib/help/content.ts` in the same branch.

- Write plain-language user guidance without contract names, API routes, or
  database details.
- Keep `keywords`, `appLinks`, `related`, and `status` accurate. Mark partial or
  coming-soon behavior honestly.
- When a public or signed-in screen exists, refresh the relevant image with
  `scripts/capture-help-screenshots.mjs`.
- Run the content-integrity test in `src/lib/help/help.test.ts`; every referenced
  screenshot must exist.
- Pure internal, backend, infrastructure, and refactor changes normally do not
  require a User Guide update.

See `docs/features/user_manual.md` for the full authoring and screenshot guide.

## UI conventions

Use `window.confirm()` sparingly; prefer the shared `ConfirmDialog` component
for consistent user experience.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
