# Architecture

This document describes how the extension is put together. It is aimed at
contributors who want to understand or modify the code. See the
[README](../README.md) for user-facing documentation.

## Components

| Component | Runs in | Responsibility |
| --- | --- | --- |
| Service worker (`src/background/service-worker.ts`) | Background | Session state machine, message router, screenshot capture queue, review tab launcher, keyboard commands |
| Content script — recorder (`src/content/recorder.ts`) | D365FO page (isolated world) | Passive event listeners, reconnects after navigation or authentication redirects |
| Content script — D365 adapter (`src/content/d365-adapter.ts`) | D365FO page | All DOM and URL knowledge specific to Dynamics 365 Finance & Operations |
| Content script — page hook (`src/content/page-hook.ts`) | D365FO page (main world) | Wraps `history.pushState` / `replaceState` so the recorder sees client-side navigations |
| Overlay widget (`src/content/overlay.ts`) | D365FO page (Shadow DOM) | Non-intrusive floating controls: snap, note, pause, stop |
| Popup (`src/popup/*`) | Extension popup | Start / stop / pause / open review |
| Review page (`src/review/*`) | Extension tab | Timeline editor, clipboard paste, export, tracker submission |
| Options page (`src/options/*`) | Extension tab | Tracker configuration and recording preferences |
| Shared modules (`src/shared/*`) | Everywhere | Types, storage, messaging, ZIP, XML exporter, tracker provider |

## Data flow

```
 User action in D365FO tab
        │
        ▼
 Content script catches event passively (click / input / history / mutation)
        │
        │  STEP_EVENT / ERROR_DETECTED / REQUEST_SNAPSHOT
        ▼
 Service worker
        │
        ├── append to active session in chrome.storage.local
        ├── optionally call chrome.tabs.captureVisibleTab
        │       │
        │       ▼
        │   snapshot blob stored in IndexedDB, keyed by session id
        │
        └── broadcast STATE_UPDATE back to the tab (overlay reflects it)

 User clicks Stop
        │
        ▼
 Service worker moves the session from "active" to the archive and opens the
 review page with the session id in the URL hash.

 Review page
        │
        ├── REVIEW_GET_SESSION / REVIEW_GET_SNAPSHOT to render timeline
        ├── REVIEW_UPDATE_SESSION (debounced) on any edit
        ├── REVIEW_ADD_PASTED_IMAGE when the user pastes from clipboard
        ├── REVIEW_EXPORT_XML to produce the .zip bundle
        └── REVIEW_SUBMIT_OTRS (v0.1 only; tracker abstraction pending) to
            submit the session as a ticket
```

## Storage

- `chrome.storage.local` keeps the **active session metadata**. It survives
  service worker restarts, full-page navigations, and AAD re-auth, which is
  why the recording can resume transparently after Microsoft's login
  redirects.
- **IndexedDB** holds the **screenshot blobs** (keyed by snapshot id, indexed
  by session id) and an **archive** of completed sessions. `chrome.storage`
  is not used for blobs because it is not designed for binary data.
- Tracker credentials and recording options live in `chrome.storage.local`
  under separate keys.

## Capture strategy

- **Clicks**: capture-phase listener on `document`. Walks up to five
  ancestors looking for a button, link, menu item, tile, or anything with an
  accessible role, then records the **visible label** (aria-label, inner
  text, or title) — not a CSS selector.
- **Field edits**: `focusin` snapshots the current value, `focusout` and
  `change` compare and emit a step with the old and new values plus the
  **human label** resolved via `aria-label` → `aria-labelledby` → associated
  `<label for>` → ancestor label container → placeholder.
- **Navigation**: the page hook (injected into the main world) wraps
  `history.pushState` / `replaceState` and dispatches a custom event. The
  content script listens for that event and emits a navigate step. A
  screenshot is taken about 400 ms later so the new form has time to render.
- **Errors**: a `MutationObserver` on `body` watches for D365FO's error
  message bar selectors. When an error appears, an error step is emitted and
  an auto-snapshot is queued.

## Screenshot pipeline

`chrome.tabs.captureVisibleTab` is rate limited and noisy. The service
worker wraps it in a queue with a 700 ms minimum gap between captures. If
the queue gets longer than a few items the overlay shows a warning so the
user knows why snapshots are skipped. Blobs are converted to PNG and stored
in IndexedDB; the step receives the snapshot id so the exporter can link
them later.

## Export format

`repro.xml` is the primary artifact. It has a small, stable schema rooted at
`<reproReport xmlns="https://d365fo.repro/schema/v1">` and contains a
`<meta>`, `<environment>`, `<description>`, and `<steps>` section with one
`<step>` element per captured event. Screenshots are referenced via
`<attachment href="screenshots/step-NNN.png" type="image/png" />`.

`metadata.json` is a raw dump of the session object, included so that
automation can read a session without parsing XML.

The bundle is packaged with a tiny dependency-free STORE-mode ZIP writer
(`src/shared/zip.ts`). STORE mode was chosen over DEFLATE to keep the
runtime code small and avoid wasm or native-compression dependencies; the
savings from compressing XML and PNG streams are modest anyway because PNG
is already deflated.

## Adapter isolation

Everything that knows what a D365FO form *looks like* lives in
`src/content/d365-adapter.ts`. Selectors are permissive and fall back to
generic strategies when a known selector misses, so a selector drift in a
future D365FO release degrades gracefully (labels may show `(placeholder)`
fallback) instead of silently dropping events. To support a different SaaS
application, add a sibling adapter and switch on the page host — none of
the recorder, the overlay, or the exporter need to change.

## Messaging

A single typed envelope `{ type, ... }` is used for every `runtime.sendMessage`
call. See [`src/shared/types.ts`](../src/shared/types.ts) for the full
`Message` union. The service worker's `onMessage` handler is the only place
that mutates session state; content scripts, the popup, the review page,
and the options page all communicate through messages so there is a single
authoritative source of truth.
