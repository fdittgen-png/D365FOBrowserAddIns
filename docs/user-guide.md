# User guide

This guide walks you through using the D365FO Repro Recorder from install
to handing a finished reproduction bundle to a developer.

## 1. Install

### From source (current recommended method)

1. Download or clone the repository:
   ```bash
   git clone https://github.com/fdittgen-png/D365FOBrowserAddIns.git
   cd D365FOBrowserAddIns
   npm install
   npm run build
   ```
2. Open `edge://extensions` (or `chrome://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and point it at the `dist/` folder that the
   build produced.
5. Pin the extension icon to the toolbar so you can start a recording
   with one click.

### From the store

Edge Add-Ons and Chrome Web Store listings are tracked in
[issue #16](https://github.com/fdittgen-png/D365FOBrowserAddIns/issues/16).

## 2. Record your first session

1. Open a tab on a Dynamics 365 Finance & Operations tenant.
2. Click the extension icon. The popup shows **Idle**.
3. Click **Start recording** (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
4. A floating widget appears top-right of the D365FO page with a red
   **Recording** indicator and a step counter.
5. Reproduce the issue exactly as you normally would:
   - Navigate between forms.
   - Fill in fields and change values.
   - Click the buttons that trigger the bug.
   - Let the error banner fire.
6. When you are done, click **Stop** on the floating widget (or press
   <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> again). The review page
   opens automatically in a new tab.

### What the recorder captures

| What you did | What ends up in the report |
| --- | --- |
| Opened a form | A **navigate** step with the form title, menu item, and URL |
| Clicked a button or menu item | A **click** step with the button's visible label |
| Changed a field | An **edit** step with the field's **human label** and old → new value |
| Saw an error banner | An **error** step with the message text, auto-screenshot |
| Pressed <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | A manual snapshot step |
| Pressed <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | A note prompt on the overlay |

Field labels come from `aria-label`, associated `<label>` elements, or
D365FO's label containers — **not** generated CSS classes. That means
the report stays readable even when Microsoft ships a UI update.

## 3. Review and edit

The review page shows a timeline of everything the recorder captured.
You can:

- **Add a title, description, severity, and tags.** The fields auto-save
  as you type.
- **Reorder or delete steps** using the arrows and X buttons on each row.
- **Add a note** to any step by typing in the per-step note field.
- **Paste screenshots** from the clipboard (<kbd>Ctrl</kbd>+<kbd>V</kbd>
  anywhere on the page). Each pasted image becomes a new step.
- **Redact PII** in any screenshot: click the **Redact** button overlaid
  on a thumbnail to open the redaction editor, drag black rectangles
  over sensitive regions, undo/redo as needed, and save. The edited
  version replaces the original in the export and in any tracker
  submission.

## 4. Export or submit

### Export as a local zip bundle

Click **Export XML bundle**. You get a `.zip` file containing:

```
d365fo-repro-YYYYMMDD-HHMM-<slug>.zip
├── repro.xml           Structured document (human- and machine-readable)
├── metadata.json       Full session dump for automation
└── screenshots/
    ├── step-001.png
    ├── step-004.png
    └── pasted-01.png
```

`repro.xml` references screenshots by relative path. You can attach the
zip to an email or upload it to any ticketing system by hand.

### Submit to a ticket tracker

The extension can submit the session directly as a ticket in OTRS,
Atlassian Jira, or Azure DevOps. Configure the provider once in
**Settings** (click the gear icon in the popup, or open the extension's
options page):

1. Pick a provider from the dropdown.
2. Fill in the fields (base URL, credentials, project/queue, etc.).
3. Click **Test connection** to verify the endpoint is reachable.
4. Click **Save**, then **Make active** if it is not already.

Back in the review page, click **Submit to tracker**. On success the
extension opens the new ticket in a new tab. The whole bundle is sent
over a single HTTPS request; nothing is logged or relayed through any
third-party service.

## 5. Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | Start or stop recording |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Take a manual snapshot |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | Add a note |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Pause or resume recording |

Remap any of them in `chrome://extensions/shortcuts` or
`edge://extensions/shortcuts`, or follow the **Remap shortcuts →** link
on the Settings page.

## 6. Screenshot strategies

Three modes live under **Settings → Recording → Screenshot strategy**:

- **Visible viewport only** (default): fastest, captures exactly what
  you see. Good enough for most forms.
- **Full page via scroll stitching**: scrolls the form, captures
  viewport-sized tiles, and stitches them into a single PNG.
  Requires no extra permissions. Hides fixed headers during subsequent
  captures so they do not appear as duplicates.
- **High-fidelity full page (requires debugger)**: uses the Chromium
  DevTools protocol. Shows a yellow "Started debugging this browser"
  bar. You must grant the `debugger` permission the first time you
  save this setting.

## 7. Recovering an interrupted session

If the browser crashes or the service worker restarts mid-recording,
the session is preserved in local storage. Next time you open the
popup, a yellow banner reads **"Unsaved recording found — N steps from
\<time ago\>"** with three buttons:

- **Resume** — reattaches the session to the current active tab and
  keeps recording.
- **Review** — stops the session and opens the review page so you can
  finish editing and export it.
- **Discard** — archives the session (never silently deletes it) and
  clears the active slot.

## 8. Privacy

- Recording is **opt-in per session**. A visible red REC indicator
  shows when it is on.
- Every captured byte stays local until you explicitly export or
  submit.
- Tracker credentials are stored in `chrome.storage.local` and are
  sent only to the tracker host you configure here, only when you
  click Submit.
- Screenshots may contain personal or business data. Use the
  redaction editor before sharing.

## 9. Removing all local data

Uninstalling the extension from `chrome://extensions` clears everything
(chrome.storage.local and the IndexedDB that holds screenshots). If
you want to keep the extension installed but wipe local data, open
DevTools on the extension's background page and run
`indexedDB.deleteDatabase('d365fo-repro'); chrome.storage.local.clear()`.
