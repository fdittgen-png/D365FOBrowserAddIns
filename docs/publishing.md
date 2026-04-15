# Publishing to Microsoft Edge Add-Ons

Step-by-step walkthrough of the Partner Center submission, keyed to
the four sidebar sections on
`partner.microsoft.com/dashboard/microsoftedge/<extension-id>`:

1. Packages
2. Availability
3. Properties
4. Store listings

Each field has the exact value to paste, taken from
[`store-listing-edge.md`](store-listing-edge.md).

---

## Before you begin

- You are signed in to Partner Center with the
  `FDITTGEN@FLORIANDITTGEN.onmicrosoft.com` identity.
- The extension draft already exists (Store ID `0RDCK9BN997L`,
  Product ID `470b1fb4-6050-4a67-ba67-6ff709af5b75`).
- A fresh production build is in `dist-store/`:
  ```bash
  npm run package:store
  ```
- The 300×300 store tile is at `assets/store/tile-300.png`:
  ```bash
  npm install --no-save sharp
  node scripts/rasterize-icons.mjs
  ```

## 1. Packages

**What:** upload the zipped production build.

1. Sidebar → **Packages** → **Upload**
2. Pick `dist-store/d365fo-browser-addins-0.1.0-edge.zip`
3. Wait for validation. A green check next to the row means you are
   done with this section.

**Common validation errors and fixes**

| Error | Fix |
| --- | --- |
| `Description ... exceeds 132 characters` | Shorten `_locales/en/messages.json` → `extDescription`, rebuild, re-package. |
| `Package has not been signed` | Edge handles signing on its side — ignore if the package actually uploaded. |
| `Invalid manifest version` | Must be `manifest_version: 3`. We already are. |
| `Host permissions too broad` | The manifest must not contain `<all_urls>` or `http://*/*`. `scripts/validate-manifest.mjs` guards against this locally. |

## 2. Availability

**What:** who can install it and in which markets.

| Field | Value |
| --- | --- |
| Visibility | **Public** |
| Audience | **Public audience** (not private audience) |
| Markets | **All markets** — the extension has no regional restrictions |
| Free or paid | **Free** |
| Release | **As soon as possible after certification** |
| Age group | **Adult (13+)** — it's a developer tool, no age-sensitive content |

Click **Save** at the top of the section. The green check appears in
the sidebar.

## 3. Properties

**What:** category, support URLs, permissions justifications.

### Category

```
Developer tools
```

### Website, support, privacy

| Field | Value |
| --- | --- |
| Website URL | `https://github.com/fdittgen-png/D365FOBrowserAddIns` |
| Support contact details | `https://github.com/fdittgen-png/D365FOBrowserAddIns/issues` |
| Privacy policy URL | `https://github.com/fdittgen-png/D365FOBrowserAddIns/blob/main/docs/privacy-policy.md` |

### Permissions justifications

Partner Center asks you to justify each declared permission. Paste
these directly:

| Permission | Justification |
| --- | --- |
| `activeTab` | Interact with the current D365FO tab when the user clicks the extension icon to start a recording. |
| `tabs` | Track which tab a recording is bound to so the content script in unrelated tabs does not attach listeners or emit duplicate events. |
| `storage` | Persist the active session metadata, recording options, and tracker settings locally in chrome.storage.local so the session survives service worker restarts and browser navigation redirects. |
| `scripting` | Inject a page-world script that wraps history.pushState/replaceState so single-page D365FO navigations are visible to the recorder. Also drives the scroll-based full-page capture path. |
| `downloads` | Save exported XML bundles and DOCX files through the browser's native download dialog when the user clicks Export. |
| `host_permissions (*.dynamics.com, *.operations.dynamics.com, *.cloudax.dynamics.com)` | Run the content script on Dynamics 365 Finance & Operations tenants. The extension is non-functional on any other host. |
| `optional_host_permissions (*.atlassian.net, *.atlassian.com, dev.azure.com, *.visualstudio.com)` | Request access to a specific tracker host at submit time, only when the user clicks Submit to Jira or Azure DevOps, and only for the URL they configured in Settings. |
| `optional_permissions (debugger)` | Opt-in only. Enables the high-fidelity full-page screenshot mode via the DevTools protocol. Off by default. |

### Product features (optional)

Paste one per line if Partner Center offers a "Product features"
multiline field:

```
Record clicks, field edits, and navigation on Dynamics 365 FO
Automatic screenshots on error banners
Review and edit the timeline before export
PII redaction editor for screenshots
Export as XML bundle (.zip)
Export as Word document (.docx)
Submit to OTRS, Atlassian Jira, Azure DevOps, or GitHub Issues
Keyboard shortcuts
Accessible, dark-mode aware, localized (English + German)
Open source under the MIT License
```

Click **Save**.

## 4. Store listings

The **only** part that requires per-language content. Start with
English (which is the default locale the package declares).

### Add a store listing for **English (United States)**

All the values come from [`store-listing-edge.md`](store-listing-edge.md).
Paste each field:

| Field | Source |
| --- | --- |
| Display name | Section 1 |
| Short description | Section 2 |
| Detailed description | Section 3 |
| Search terms | Section 4 |
| Store logo (300×300) | Upload `assets/store/tile-300.png` |
| Screenshots | 1–10 PNGs you capture (see below) |

### Screenshots — **you have to capture these**

Partner Center requires at least **one** screenshot and accepts up to
ten. Use either 1280×800 or 640×480 PNG. Microsoft rejects obvious
mock-ups, so shoot these against a real D365FO tenant if you have
access:

1. The floating overlay widget in the top-right of a D365FO form,
   showing "Recording" state with a few steps counted
2. The review page with a timeline of navigate / click / edit / error
   steps and at least two thumbnails visible
3. The Settings page with the GitHub Issues provider form filled in
4. The Export XML bundle download dialog
5. The Submit to tracker toast showing a successful GitHub issue URL

Capture at 1280×800 in the browser devtools device toolbar so the
aspect ratio is exact. Save PNGs to a scratch folder — don't commit
them to the repo unless you want them versioned.

### German listing (optional but recommended)

The extension is already localized to German via
`_locales/de/messages.json`. Add a second store listing for
**German (Germany)** with a translated display name, short
description, and detailed description. The tile and screenshots can
be reused.

Shorter German description (117 chars, already in the manifest):

```
D365FO-Reproduktionen aufzeichnen: Klicks, Änderungen, Fehler, Screenshots. Export als XML/DOCX oder an Ticketsystem.
```

For the detailed description, a rough translation of the English
block works; a native German speaker review before publish is worth
the extra day if you have one available.

Click **Save**.

## Review and submit

1. Back on the **Extension overview** page, every sidebar section
   should now have a green check.
2. Click **Submit for certification** at the top of the overview.
3. Partner Center shows a summary. Confirm.
4. Microsoft's review takes 1–7 business days. You will get an email
   at `fdittgen@gmx.net` with the decision.

## After publication

- The extension's public URL will appear on the **Extension overview**
  page under **Extension identity → URL**. Update
  `CHANGELOG.md` and the README with it.
- Subsequent updates: bump the version in `package.json` and
  `public/manifest.json` (use `npm run release <semver>`), rebuild,
  re-package, upload the new zip to the **Packages** section, and
  resubmit for certification. Store listing fields persist across
  updates — you only re-edit them if you want to change the copy.

## Rollback

If a published update causes problems, Partner Center does not offer
a one-click rollback. The fastest recovery is to submit the previous
version's zip again with a bumped version number (e.g. if `0.2.0`
broke users, republish `0.1.0`'s contents as `0.2.1`).

Keep previous `dist-store/*.zip` artifacts around — they are your
rollback bundles.
