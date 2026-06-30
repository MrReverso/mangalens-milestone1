# MangaLens Project Instructions

MangaLens is a Chrome Manifest V3 extension developed in incremental milestones.
The React popup sends typed commands; the singleton content controller owns page
sessions and overlays; the background service worker owns browser-level capture.

Run before delivery:

- `pnpm install --frozen-lockfile`
- `pnpm compile`
- `pnpm test`
- `pnpm build`

Keep permissions minimal unless a milestone explicitly changes them. Add no
network requests unless explicitly requested. Never pass DOM elements through
Chrome messages; use typed messages with runtime validation. Preserve existing
tests and behavior. Work on branches, open draft PRs, never commit to `main`,
and never merge automatically.

Keep popup, content-script, and background responsibilities separated. Never use
`innerHTML` or unsafe HTML. Clean up listeners, observers, timers, locks, and
AbortControllers.
