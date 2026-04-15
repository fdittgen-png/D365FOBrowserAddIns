# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffolding: Manifest V3 extension, TypeScript + esbuild
  build pipeline, governance files, CI workflow.
- Content recorder that captures navigation, clicks, and form field edits
  inside Dynamics 365 Finance & Operations tabs.
- Shadow-DOM floating overlay widget for in-page control of recording.
- Popup with start / stop / pause / review controls.
- Review page with step timeline, reorder / delete, clipboard image paste,
  and free-text notes per step.
- Options page for configuring the ticket tracker and recording preferences.
- XML + ZIP export bundle containing `repro.xml`, `metadata.json` and the
  captured screenshots.
- Optional submission of the captured session as a ticket in an external
  tracker system.
- Keyboard shortcuts for toggle, snapshot, note, and pause/resume.
- Mock D365FO fixture page for local development without a tenant.
