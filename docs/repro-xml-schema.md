# repro.xml schema (v1)

This document describes the structured XML document produced by the D365FO
Browser Add-Ins extension. The authoritative schema files live in
[`schema/`](../schema):

- [`schema/repro-v1.xsd`](../schema/repro-v1.xsd) — W3C XML Schema for
  `repro.xml`
- [`schema/metadata-v1.schema.json`](../schema/metadata-v1.schema.json) — JSON
  Schema for the `metadata.json` sidecar

## Namespace

All elements live in the namespace `https://d365fo.repro/schema/v1`.

This URI is deliberately not resolvable to anything — it's an identifier
only, not a download location.

## Root element

```xml
<reproReport xmlns="https://d365fo.repro/schema/v1" version="1" sessionId="ses_xxxxxxxx">
  <meta>...</meta>
  <environment>...</environment>
  <description>...</description>
  <steps>...</steps>
</reproReport>
```

`version` is the schema version (starts at `1`). Breaking changes will
increment it to `2` and the extension will continue to emit the older
version as a fallback for one full release cycle.

`sessionId` is the unique identifier of the recording session — stable
across the export and the tracker submission.

## `<meta>`

```xml
<meta>
  <title>GL posting fails with invalid account</title>
  <severity>high</severity>
  <startedAt>2026-04-15T09:37:14.000Z</startedAt>
  <endedAt>2026-04-15T09:38:12.000Z</endedAt>
  <extensionVersion>0.1.0</extensionVersion>
  <tags>
    <tag>gl</tag>
    <tag>posting</tag>
  </tags>
</meta>
```

- `title` — user-editable short title
- `severity` — enum `low`, `med`, `high`
- `startedAt` / `endedAt` — ISO 8601 UTC dateTime
- `extensionVersion` — the version that produced the report
- `tags` — optional, zero or more `<tag>` children

## `<environment>`

```xml
<environment>
  <host>usmf.dynamics.com</host>
  <tenant>usmf</tenant>
  <company>USMF</company>
  <language>en-us</language>
  <userAgent>Mozilla/5.0 ...</userAgent>
  <initialUrl>https://usmf.dynamics.com/?cmp=USMF&amp;mi=LedgerJournalTable</initialUrl>
</environment>
```

All elements are optional and reflect the state at the start of the
recording.

## `<description>`

User-editable free-text block. One element, no children.

## `<steps>`

Ordered list of `<step>` elements, one per captured event.

```xml
<step index="1" kind="navigate" ts="2026-04-15T09:37:14.200Z" id="st_xxxxxxxx">
  <formTitle>General journal entries</formTitle>
  <menuItem>LedgerJournalTable</menuItem>
  <company>USMF</company>
  <url>https://usmf.dynamics.com/?cmp=USMF&amp;mi=LedgerJournalTable</url>
  <attachment href="screenshots/step-001.png" type="image/png" />
</step>
```

### Common attributes

Every `<step>` carries:

| Attribute | Type | Description |
| --- | --- | --- |
| `index` | positive integer | 1-based position in the timeline |
| `kind` | enum | One of `navigate`, `click`, `edit`, `error`, `manual-snap`, `note`, `pasted-img` |
| `ts` | ISO 8601 dateTime | UTC timestamp when the event was captured |
| `id` | string | Unique id of the step within the session |

### Per-kind element contents

| Kind | Child elements |
| --- | --- |
| `navigate` | `formTitle?`, `menuItem?`, `company?`, `url` |
| `click` | `label`, `role?`, `formTitle?` |
| `edit` | `fieldLabel`, `oldValue`, `newValue`, `formTitle?` |
| `error` | `message`, `formTitle?` |
| `manual-snap` | `formTitle?` |
| `note` | `text` |
| `pasted-img` | (none) |

Any step may additionally contain:

- `<note>` — a free-text annotation added by the user in the review page
- `<attachment href="..." type="image/png" />` — one or more screenshot
  references resolved to files inside the `screenshots/` folder of the
  exported zip

## Versioning

The schema is stable within a major version. Adding new optional
elements or enumeration values is a **non-breaking** change. Removing
elements, renaming, or changing the required/optional status is a
**breaking** change and must be accompanied by a new namespace URI
(`https://d365fo.repro/schema/v2`) and a new XSD file.

## Validation

Tests in `tests/unit/exporter.test.ts` snapshot-check the XML output
against a golden fixture in `tests/fixtures/golden-repro.xml`, and the
`schema/repro-v1.xsd` is a reference for external consumers. A
contributor changing the exporter output should update both the golden
file and, where the change is deliberate, the XSD.
