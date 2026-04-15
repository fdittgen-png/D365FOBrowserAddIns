# Edge Add-Ons store listing — copy to paste

Every value Microsoft Partner Center asks for during a submission,
ready to copy into the form fields. Use this doc as your single source
of truth for the listing so successive updates stay consistent.

Project: https://github.com/fdittgen-png/D365FOBrowserAddIns
Publisher: **Florian Dittgen**
Contact email: **fdittgen@gmx.net**

---

## 1. Display name

```
D365FO Repro Recorder
```

Max 50 chars. Current: 21. Keep this stable across versions — changing
the display name after publication requires a new certification.

## 2. Short description (Partner Center calls this "Description" under Store listings)

This field is the 132-char string Edge shows under the listing title
in search results. It must match the `manifest.json` description or
certification will reject the package.

```
Record D365FO repro sessions: clicks, edits, errors, screenshots. Export as XML or DOCX, submit to tracker.
```

107 chars. Do not exceed 132.

## 3. Long description (Partner Center calls this "Detailed description")

Markdown-friendly. Edge renders basic formatting. Paste the block
between the fenced markers (don't include the fences themselves).

```
**Record, review, and submit reproduction scenarios for Microsoft Dynamics 365 Finance & Operations.**

Support engineers, consultants, and power users waste hours every
week writing up repro steps by hand. This extension automates the
capture end-to-end. One click to start, one click to stop, and you
have a complete, structured repro document with screenshots and
field-level edits — ready to hand off to a developer.

## What it captures

- **Navigation** between D365FO forms, resolved to the form title and
  menu item (not opaque URLs)
- **Clicks** on buttons, tabs, menu items, and tiles — using the
  element's visible label, not a CSS selector
- **Field edits** with the field's human-readable label plus the
  old and new values
- **Error banners** from D365FO's message bar — auto-detected and
  auto-screenshot
- **Full-page or viewport screenshots** at moments you choose, or
  automatically on navigation and error banners
- **Free-text notes** you type into the floating overlay while you
  work
- **Pasted images** from the clipboard, straight into the review page

## What it produces

- **XML bundle** (.zip): structured `repro.xml` + `metadata.json` +
  screenshots, self-contained and ready for any ticket system
- **Word document** (.docx): a single readable file you can forward,
  email, or attach to SharePoint
- **Ticket submission** directly to one of four trackers:
  - OTRS (Generic REST connector)
  - Atlassian Jira (Cloud or Data Center)
  - Azure DevOps (Services or Server)
  - GitHub Issues (.com or Enterprise)

## Why it is useful

- **Deterministic repro steps.** The recorder captures the exact
  order of user actions with human-readable labels, not fragile
  selectors, so reports survive D365FO UI updates.
- **Privacy-aware.** Built-in redaction editor lets you draw black
  rectangles over screenshots before exporting, so PII never leaves
  your machine by accident.
- **Works offline.** Everything stays in your browser until you
  explicitly click Export or Submit. No servers, no analytics, no
  telemetry.
- **Recovers from crashes.** If the browser restarts mid-recording,
  the extension offers to resume, review, or discard the unsaved
  session.
- **Accessible.** Full keyboard shortcut support, screen-reader
  labels, reduced-motion compliance, dark mode.
- **Open source.** MIT licensed, public repository, no closed-source
  components.

## Keyboard shortcuts

- `Alt+Shift+R` — start or stop recording
- `Alt+Shift+S` — take a manual snapshot
- `Alt+Shift+N` — add a note
- `Alt+Shift+P` — pause or resume

## Privacy at a glance

- Recording is opt-in per session.
- Captured data stays on your device in `chrome.storage.local` and
  IndexedDB.
- Nothing leaves your browser unless you export a file or explicitly
  submit to a tracker you configure.
- Full privacy policy:
  https://github.com/fdittgen-png/D365FOBrowserAddIns/blob/main/docs/privacy-policy.md

## Open source

Source code, issue tracker, and documentation:
https://github.com/fdittgen-png/D365FOBrowserAddIns

Released under the MIT License.
```

## 4. Search terms

Comma-separated, max ~7 keywords. Edge indexes these to help users
find the listing.

```
d365fo, dynamics 365, repro recorder, bug report, screenshots
```

## 5. Category

```
Developer tools
```

(Secondary choice if Developer tools isn't offered: **Productivity**.)

## 6. URLs

| Field | Value |
| --- | --- |
| Website URL | `https://github.com/fdittgen-png/D365FOBrowserAddIns` |
| Support URL | `https://github.com/fdittgen-png/D365FOBrowserAddIns/issues` |
| Privacy policy URL | `https://github.com/fdittgen-png/D365FOBrowserAddIns/blob/main/docs/privacy-policy.md` |

## 7. Notification email

```
fdittgen@gmx.net
```

Partner Center sends certification decisions and reviewer feedback
here. Pick an address you actually check.

## 8. Assets you upload

| Asset | Source file | Notes |
| --- | --- | --- |
| Tile / logo (300×300 PNG) | `assets/store/tile-300.png` | Generated by `node scripts/rasterize-icons.mjs` |
| Store screenshots (1–10, 1280×800 or 640×480 PNG) | You capture these | See the publishing guide for what to shoot |

## 9. Submission notes (free-form field for the certification team)

Paste this into the "Notes for certification" textarea to make the
reviewer's life easier and reduce round-trips:

```
This extension records user actions on Microsoft Dynamics 365
Finance & Operations tabs (clicks, form field edits, navigation,
error banners) and produces a structured repro document that the
user can export locally as a .zip or .docx, or submit to a ticket
tracker the user configures (OTRS, Jira, Azure DevOps, or GitHub
Issues).

Recording is opt-in per session via a visible "Start recording"
button. A floating red indicator shows when recording is active.
Data stays in chrome.storage.local and IndexedDB until the user
explicitly exports or submits. There is no telemetry, no analytics,
and no backend server operated by the extension author.

Content scripts run only on *.dynamics.com, *.operations.dynamics.com,
and *.cloudax.dynamics.com as declared in the manifest. Tracker
endpoints are requested via chrome.permissions.request at submit
time and only for the URL the user configured.

Source code, tests, and documentation:
https://github.com/fdittgen-png/D365FOBrowserAddIns

Privacy policy:
https://github.com/fdittgen-png/D365FOBrowserAddIns/blob/main/docs/privacy-policy.md
```
