# Browser compatibility

This project targets Manifest V3 browser extensions. The table below
lists the minimum versions the maintainers test against.

## Support matrix

| Browser | Minimum version | Status | Notes |
| --- | --- | --- | --- |
| Microsoft Edge (stable) | 116 | ✅ Supported | Primary development target. CI smoke tests run on Chromium stable. |
| Google Chrome (stable) | 116 | ✅ Supported | Feature parity with Edge. |
| Google Chrome (beta) | current | ✅ Supported | Covered by CI. |
| Chromium (other) | 116 | 🟡 Best effort | Brave, Arc, Vivaldi. Not actively tested, but should work. |
| Mozilla Firefox | n/a | ❌ Not supported | MV3 support in Firefox differs enough that several features (service worker lifetime, `chrome.tabs.captureVisibleTab` edge cases, `chrome.debugger` for full-page capture) need a parallel implementation. Tracked for a future milestone — see below. |

The minimum Chromium version is declared in
[`public/manifest.json`](../public/manifest.json) as
`minimum_chrome_version: "116"`. If you need to raise it, bump the
number there and in this document.

## Required browser APIs

| API | Used for | Notes |
| --- | --- | --- |
| `chrome.storage.local` | Active session, options, tracker settings | Survives service worker restarts — essential for the recovery flow |
| `chrome.tabs.captureVisibleTab` | Viewport screenshots | Rate-limited; wrapped in a 700 ms queue |
| `chrome.scripting.executeScript` | Scroll control during full-page capture | MV3 replacement for `tabs.executeScript` |
| `chrome.runtime.onMessage` | All popup ↔ content ↔ review messaging | Typed `Message` envelope |
| `chrome.commands` | Keyboard shortcuts | Remap happens at the browser level |
| `chrome.permissions` | Optional host grants for tracker submission | Requested at submit time, not install |
| `chrome.debugger` (optional) | High-fidelity full-page capture | Off by default; shows the yellow bar |
| `indexedDB` | Snapshot blob store | Larger-than-`chrome.storage` binaries |
| `crypto.getRandomValues` | Session and step ids | Both Node 20+ and every supported browser ship it |

## Firefox status

Firefox added a form of Manifest V3 support starting with version 109
but several of the APIs we rely on behave differently:

- Firefox backgrounds use event pages, not true service workers. The
  session lifetime guarantees are different and would require a
  different recovery mechanism.
- `chrome.tabs.captureVisibleTab` accepts fewer format options on
  Firefox and has distinct permission prompts.
- `chrome.debugger` is not supported at all, so the high-fidelity
  capture strategy would need to fall back to scroll stitching.
- Some `chrome.scripting.executeScript` options (`world: 'MAIN'`) are
  behind flags.

A Firefox port is a welcome contribution but requires parallel
implementations of the capture pipeline and the page-world history
hook. Track progress in
[GitHub issues](https://github.com/fdittgen-png/D365FOBrowserAddIns/issues)
under the `firefox` label (not yet created).

## CI coverage

The `ci.yml` workflow builds and typechecks on Ubuntu with Node 20.
The `e2e` job runs Playwright against the Chromium channel Playwright
bundles, which tracks stable. To smoke-test against Chrome beta
explicitly:

```yaml
- run: npx playwright install --with-deps chromium-tip-of-tree
```

Add that step to a new CI job if you need to catch breakage before
Chrome stable ships a problematic change.

## Reporting compatibility regressions

Open an issue using the **Bug report** template and fill in the
browser, browser version, and operating system fields. If you have
console output, include it — content script errors often fire silently
and only the devtools record them.
