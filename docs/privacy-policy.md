# Privacy Policy — D365FO Repro Recorder

**Effective date:** 2026-04-15
**Publisher:** Florian Dittgen
**Project:** https://github.com/fdittgen-png/D365FOBrowserAddIns
**Contact:** fdittgen@gmx.net (please prefer filing a
[GitHub issue](https://github.com/fdittgen-png/D365FOBrowserAddIns/issues)
for non-sensitive questions)

This page explains exactly what data the **D365FO Repro Recorder**
browser extension collects, where it is stored, and under which
circumstances any of it leaves your device.

## At a glance

- Recording is **opt-in per session**. Nothing is captured until you
  click **Start recording**.
- Captured data stays **on your device only** — in
  `chrome.storage.local` and IndexedDB inside your browser profile.
- **Nothing is transmitted** by the extension on its own. Data leaves
  your device only when you explicitly click **Export XML bundle**,
  **Export DOCX**, or **Submit to tracker**, and then only to the
  destination you chose.
- **No telemetry, no analytics, no third-party trackers** of any kind.
- The extension has **no servers**. There is no backend.

## What the extension records when you press Start

A recording session captures:

- **URL changes** inside the active Dynamics 365 Finance & Operations
  tab, parsed into form / menu item / legal entity.
- **Clicks** on buttons, links, and menu items, resolved to the
  element's visible label (not the underlying code or internal ID).
- **Field edits**: the human-readable field label plus the old and
  new values you typed or selected.
- **Error banners** that D365FO displays, with their message text.
- **Screenshots** of the visible browser viewport (or the full page,
  if you enable that option) at moments you choose, or automatically
  on navigation and error banners.
- **Manual notes** you type into the floating overlay.
- **Images you paste** into the review page with <kbd>Ctrl</kbd>+<kbd>V</kbd>.

Recording is bound to the tab you started it in. The extension does
not capture data from any other tab, and does not run on any site
other than the Dynamics 365 hosts listed in the manifest.

## Where captured data is stored

- **`chrome.storage.local`** holds the active session metadata
  (session id, captured steps, user title / description / tags).
  This survives service worker restarts and full-page navigations.
- **IndexedDB** (`d365fo-repro` database) holds the screenshot blobs
  and an archive of completed sessions.
- Both stores are **scoped to your browser profile on your device**.
  Uninstalling the extension removes them.

## What leaves your device

The extension never transmits anything on its own. Data leaves your
device only in the three scenarios below, each triggered by an
explicit click:

### 1. Export XML bundle (local file download)

Produces a `.zip` on your computer containing `repro.xml`,
`metadata.json`, and the captured screenshots. The file is saved
through Chrome's native download dialog. Nothing is uploaded anywhere.

### 2. Export DOCX (local file download)

Produces a `.docx` on your computer. Same behaviour as the XML bundle
— nothing is uploaded.

### 3. Submit to tracker

Sends the session as a ticket to an issue tracker **you configure in
the extension's Settings**. Supported trackers:

- **OTRS** (your on-prem or hosted instance)
- **Atlassian Jira** (Cloud or Data Center)
- **Azure DevOps** (Services or Server)
- **GitHub Issues** (GitHub.com or GitHub Enterprise)

For each tracker:

- The endpoint is **exactly the one you typed** in the Settings page.
  The extension never sends to a different URL.
- The credentials (passwords, API tokens, Personal Access Tokens) are
  stored in `chrome.storage.local` on your device. They are included
  in the HTTPS request to the tracker, and nowhere else.
- The request goes directly from your browser to the tracker's API.
  There is no intermediate server under the extension maintainer's
  control.
- Each tracker has its own privacy policy governing what happens to
  the data after it arrives. Please consult those policies for your
  chosen tracker.

**Host permissions** for tracker endpoints are requested at the
moment you click Submit, not at install time. If you deny the prompt,
the submission fails and no data is sent.

## What the extension does NOT collect

- No browsing history outside Dynamics 365 hosts.
- No data from other tabs.
- No keystroke logging beyond the form field value at focus and blur.
- No clipboard contents other than images you explicitly paste into
  the review page.
- No cookies or local storage from the D365FO page itself.
- No account or identity information beyond what D365FO shows in its
  own user chip (which is included in the recording for your
  reference, not transmitted anywhere by default).
- No analytics, no crash reporting, no usage metrics.

## Permissions explained

The extension requests these permissions (declared in
[manifest.json](../public/manifest.json)):

| Permission | Why |
| --- | --- |
| `activeTab` | Interact with the current D365FO tab when you click the extension icon |
| `tabs` | Track which tab a recording is bound to so the content script in other tabs doesn't misbehave |
| `storage` | Persist session metadata, options, and tracker settings locally |
| `scripting` | Inject the page-world history hook that makes single-page navigations visible to the recorder |
| `downloads` | Save the exported XML and DOCX files via the browser's native download dialog |
| `host_permissions: https://*.dynamics.com/*` (and related Microsoft hosts) | Run the content script on D365FO tenants |
| `optional_host_permissions: *.atlassian.net, dev.azure.com, *.visualstudio.com, *.atlassian.com` | Request access to your specific tracker host at submit time, **only** for the URL you configure |
| `optional_permissions: debugger` | Opt-in high-fidelity full-page screenshot mode. Not granted by default. |

## Children's data

The extension is a developer / analyst productivity tool and is not
directed at children. It does not knowingly collect data from users
under 13.

## Third-party code

The built extension bundles only its own source code plus TypeScript
type definitions at compile time. No analytics SDKs, no advertising
SDKs, no remote script loading.

## Changes to this policy

This policy is versioned in the project's Git history at
`docs/privacy-policy.md`. Breaking changes (anything that adds a
new data collection or a new transmission path) will increment the
extension's minor version and be listed in
[CHANGELOG.md](../CHANGELOG.md).

## Contact

For privacy concerns, please:

- File a public issue at
  https://github.com/fdittgen-png/D365FOBrowserAddIns/issues
- Or email **fdittgen@gmx.net**

For security vulnerabilities, do not file a public issue — see
[SECURITY.md](../SECURITY.md) for the private reporting channel.
