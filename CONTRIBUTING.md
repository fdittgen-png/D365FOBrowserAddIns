# Contributing to D365FO Browser Add-Ins

Thanks for your interest in contributing. This project is open source under
the MIT license and welcomes issues, pull requests, and discussion.

## Ground rules

- Be respectful — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- For non-trivial changes, open an issue first to discuss the approach.
- Keep pull requests focused. One logical change per PR.
- Every PR should build cleanly with `npm run build` and pass `npm run typecheck`.
- New functionality should come with a test where reasonable.

## Development setup

Prerequisites: Node.js 20 LTS or newer (see [.nvmrc](.nvmrc)), npm 10+, a
Chromium-based browser (Edge or Chrome, stable channel).

```bash
git clone https://github.com/fdittgen-png/D365FOBrowserAddIns.git
cd D365FOBrowserAddIns
npm install
npm run build
```

Load the built extension:

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` directory.

For iterative development use `npm run watch` — esbuild rebuilds on save and
you can hit the **Reload** button on the extension card.

### Running locally without a D365FO tenant

The `tests/fixtures/mock-d365.html` page emulates the bits of D365FO that the
recorder relies on (form title, URL params, error banner, labeled fields).
Grant the extension access to a local file or `http://localhost` origin from
the extension details page, then open the fixture in a tab and record a flow.

## Project structure

```
.
├── public/             Static assets copied verbatim into dist/
│   ├── manifest.json   MV3 manifest
│   ├── popup/          Popup HTML/CSS
│   ├── review/         Review page HTML/CSS
│   ├── options/        Settings page HTML/CSS
│   └── icons/
├── src/
│   ├── background/     Service worker (session state, capture, routing)
│   ├── content/        Content script, D365FO DOM adapter, overlay widget
│   ├── popup/          Popup logic
│   ├── review/         Review / editor logic
│   ├── options/        Settings logic
│   └── shared/         Cross-cutting: types, storage, messaging, exporter, zip, trackers
├── tests/
│   ├── fixtures/       Mock pages for manual and automated testing
│   └── unit/           Unit tests (vitest)
├── docs/               Architecture and contributor docs
├── scripts/            Build scripts
└── .github/            Workflows, issue templates, PR template
```

## Code style

- TypeScript strict mode is on; keep it on.
- Prefer small, composable modules over classes unless state is involved.
- Content scripts must attach listeners passively — never call
  `preventDefault()` or otherwise interfere with the host page.
- D365FO-specific DOM and URL knowledge lives in `src/content/d365-adapter.ts`.
  If a new selector is needed, add it there, not in the recorder.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new user-facing capability
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or fixing tests
- `build:` build system / tooling
- `ci:` continuous integration
- `chore:` repo maintenance

Example: `feat(recorder): capture numeric spinner edits via wheel events`

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` produces a clean `dist/`
- [ ] New behavior has a test or a manual verification note
- [ ] Documentation updated if user-facing behavior changed
- [ ] No secrets, credentials, tenant names, or real user data in screenshots or fixtures

## Reporting security issues

Please do not open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for responsible disclosure details.
