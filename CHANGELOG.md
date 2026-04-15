# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-15

First public release. All v0.1 milestone issues landed except store
publishing (#16), which tracks the Edge Add-Ons and Chrome Web Store
submissions and stays open for the maintainer to complete manually.

### Added

#### Recording and capture
- Content recorder that captures navigation, clicks, form field edits,
  and D365FO error banners, attaching them to a session timeline stored
  in `chrome.storage.local` + IndexedDB so recordings survive service
  worker restarts and Entra ID re-authentication redirects.
- Shadow-DOM floating overlay widget for in-page control: recording
  indicator, step counter, snap / note / pause / stop buttons, drag to
  reposition.
- Popup with start, stop, pause, resume, and open review actions.
- Automatic snapshots on navigation and error banner appearance; manual
  snapshots via button or keyboard shortcut.
- Session recovery: if the browser crashes mid-recording, the popup
  shows a banner offering Resume, Review, or Discard next time it is
  opened.
- Three screenshot strategies: visible viewport (default), full page
  via scroll stitching with sticky-header hiding, and high-fidelity
  full page via the DevTools protocol (requires opt-in `debugger`
  permission).

#### Review, export, and submission
- Review page with step timeline, reorder / delete, clipboard image
  paste, per-step notes, and issue metadata (title, description,
  severity, tags).
- **PII redaction editor**: click any screenshot thumbnail to open a
  canvas editor with drag-to-draw black rectangles, undo / redo,
  clear-all. The edited PNG replaces the original in IndexedDB so
  every downstream consumer sees the redacted version.
- XML bundle export: produces a `.zip` containing `repro.xml`,
  `metadata.json`, and the captured PNGs, via a dependency-free
  STORE-mode ZIP writer.
- **Pluggable ticket tracker submission** with built-in providers:
  - **OTRS** (GenericTicketConnectorREST with base64 attachments)
  - **Atlassian Jira** (REST v3 create + attachment upload with
    rollback on failure; basic auth for Cloud, bearer PAT for
    Data Center; descriptions rendered as Atlassian Document Format)
  - **Azure DevOps** (Work Items API with JSON Patch create and
    attachment references)

  New providers plug in with a single file implementing a
  `TrackerProvider` interface; the options form renders dynamically
  from each provider's config schema.

#### Extension UX and plumbing
- Options page with dynamic schema-driven tracker configuration form,
  per-provider Test / Save / Activate actions, recording-option
  toggles, and a keyboard-shortcut panel with conflict detection and a
  deep link to the browser's shortcut settings.
- Accessibility pass: ARIA roles and labels, focus traps inside
  dialogs, live regions for state announcements, visible focus rings,
  text labels alongside color-only indicators (REC badge).
- Internationalization via `chrome.i18n` with English and German
  locales and a `t()` + `applyI18n()` helper. Adding a new locale is
  a drop-in `_locales/<lang>/messages.json` file.
- Manifest V3 service worker with a state machine, throttled screenshot
  capture queue (700 ms minimum gap), typed message router, keyboard
  commands (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>/<kbd>S</kbd>/<kbd>N</kbd>/<kbd>P</kbd>).

#### Adapter robustness
- D365FO DOM and URL knowledge centralized in `src/content/d365-adapter.ts`
  behind an exported `D365_SELECTORS` constant.
- Adapter telemetry: when a resolver exhausts every strategy it knows,
  it emits an `AdapterWarning` that the recorder converts into a
  `note` step prefixed `[adapter-warning]`, throttled to one per
  distinct reason, so future selector drift is visible in the timeline
  instead of silently dropping events.

#### Tooling, tests, and release
- TypeScript strict mode + esbuild build pipeline.
- **67 unit tests** with vitest + jsdom + fake-indexeddb covering the
  ZIP writer, XML exporter, D365 adapter, storage layer, i18n helper,
  and all three tracker providers (including Jira rollback and Azure
  DevOps JSON Patch body shape).
- Playwright end-to-end scaffolding that loads the unpacked extension
  in a persistent Chromium context with three smoke scenarios.
- Mock D365FO fixture page (`tests/fixtures/mock-d365.html`) for local
  development without a tenant.
- CI workflow: typecheck → unit tests → build → artifact upload, plus
  a Playwright job that uploads the HTML report on failure.
- Release workflow: tag-triggered build, Chrome + Edge zips, SHA256
  checksums, draft GitHub release with notes extracted from this file.
- Version bump helper at `scripts/release.mjs`.
- SVG icon source under `assets/icons/icon.svg` and a
  `scripts/rasterize-icons.mjs` pipeline using sharp (not a committed
  dependency).

#### Governance and docs
- MIT license.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, PR and issue
  templates, Dependabot config.
- Docs: `docs/architecture.md`, `docs/user-guide.md`,
  `docs/compatibility.md` (Edge 116+ / Chrome 116+ support matrix),
  `docs/d365-adapter.md` (adapter contribution guide).

### Known limitations

- Edge Add-Ons and Chrome Web Store listings are not yet published;
  installation is currently from source only. See issue #16.
- Firefox support is out of scope for v0.1 pending a parallel capture
  pipeline implementation.
- Screenshots capture only what is visible to the user; redaction is
  manual, not automated.
