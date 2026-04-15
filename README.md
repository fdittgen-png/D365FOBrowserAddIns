# D365FO Browser Add-Ins

[![CI](https://github.com/fdittgen-png/D365FOBrowserAddIns/actions/workflows/ci.yml/badge.svg)](https://github.com/fdittgen-png/D365FOBrowserAddIns/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)

A Chromium-based browser extension (Microsoft Edge and Google Chrome) that
records reproduction scenarios for issues in **Microsoft Dynamics 365 Finance
& Operations**, turns them into a structured document, and optionally submits
them to an external ticket tracker.

## Why

Reporting a D365FO bug today means writing down which form you were on, which
field you changed, which button you clicked, taking screenshots by hand, and
pasting everything into an email or a ticket. It is slow for the reporter and
rarely detailed enough for the developer. This extension automates the
capture so one click produces a complete, structured repro document.

## Features

- **Automatic path capture** — navigation, clicks, and form field edits are
  logged with the field's human-readable label, not a CSS selector.
- **Automatic screenshots** on navigation and D365FO error banners, with
  manual snapshots available via button or keyboard shortcut.
- **Error banner detection** — D365FO's message bar is watched and any error
  that appears becomes a step in the timeline with its own screenshot.
- **Review and edit** — a full-page review tab lets you reorder or delete
  steps, add per-step notes, paste images from the clipboard, and set a
  title, severity, and tags before exporting.
- **XML bundle export** — a `.zip` containing `repro.xml`, `metadata.json`,
  and `screenshots/*.png` is produced locally with zero network calls.
- **Ticket tracker submission** *(v0.1 supports one provider; an abstraction
  layer for OTRS, Jira, and Azure DevOps is on the roadmap)*.
- **Keyboard shortcuts** for start/stop, snapshot, note, and pause/resume.
- **Session survives authentication redirects** — the session lives outside
  the page so AAD re-auth does not interrupt recording.

## Install from source

Prerequisites: Node.js 20 LTS or newer.

```bash
git clone https://github.com/fdittgen-png/D365FOBrowserAddIns.git
cd D365FOBrowserAddIns
npm install
npm run build
```

Load the built extension:

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` directory.
4. Pin the extension to the toolbar.

## Usage

1. Open a tab on a D365FO tenant.
2. Click the extension icon and press **Start recording** (or use
   <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
3. A floating widget appears top-right of the page. Reproduce the issue as
   you normally would.
4. Click **Stop** on the widget or press the shortcut again. The review
   page opens automatically.
5. Add a title and description, review the steps, paste any extra
   screenshots, then click **Export XML bundle** or **Submit to tracker**.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | Start or stop recording |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Take a manual snapshot |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | Add a note |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Pause or resume recording |

Customize bindings in `edge://extensions/shortcuts` or
`chrome://extensions/shortcuts`.

### Export bundle layout

```
d365fo-repro-YYYYMMDD-HHMM-short-title.zip
├── repro.xml           Structured document, human- and machine-readable
├── metadata.json       Full session dump for automation
└── screenshots/
    ├── step-001.png
    ├── step-007.png
    └── pasted-01.png
```

`repro.xml` references screenshots by relative path, so the bundle is
self-contained and can be attached to any ticketing system.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for a diagram and an
explanation of the content script, service worker, storage, and review
page. Short version:

```
 Content script (D365FO tab)
        │  passive listeners: click / focus / change / navigation / errors
        ▼
 Service worker  ── chrome.storage.local ──▶  active session
        │                      IndexedDB ──▶  screenshot blobs
        │                       archive ──▶  completed sessions
        │
        ├──▶ Review page (edit, paste, export)
        └──▶ Tracker provider (XML + attachments)
```

D365FO-specific DOM knowledge is isolated in
[`src/content/d365-adapter.ts`](src/content/d365-adapter.ts) so supporting
other apps later is a matter of adding a sibling adapter.

## Testing without a tenant

A minimal mock D365FO page lives at
[`tests/fixtures/mock-d365.html`](tests/fixtures/mock-d365.html). It mimics
the form title, URL parameters, labeled fields, and error banner that the
recorder looks for, so you can exercise the full flow locally.

## Privacy

- Recording is opt-in per session. A visible red indicator shows when it is
  active.
- Captured data stays local until you explicitly export or submit.
- Screenshots capture whatever is on screen, including any sensitive data —
  review the bundle before sharing.
- Tracker credentials are stored in `chrome.storage.local` and are only
  sent to the tracker host you configure, and only when you explicitly
  submit. Host permissions for tracker endpoints are requested optionally
  at submit time, not at install time.

## Roadmap

See the [issues](https://github.com/fdittgen-png/D365FOBrowserAddIns/issues)
tracker. Highlights for the first release:

- Tracker provider abstraction for OTRS, Jira, and Azure DevOps
- PII redaction tooling on the review page
- Full-page screenshot capture
- Automated tests (unit + end-to-end)
- Publication on the Edge Add-Ons and Chrome Web Store catalogs

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.

## License

Released under the [MIT License](LICENSE).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Microsoft
Corporation. "Dynamics 365" and "Dynamics 365 Finance & Operations" are
trademarks of Microsoft Corporation.
