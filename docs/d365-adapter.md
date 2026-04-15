# D365FO adapter contribution guide

This doc explains how the Dynamics 365 Finance & Operations adapter works
and how to update it when Microsoft ships a UI change that breaks one of
our selectors.

## Where the adapter lives

All D365FO-specific DOM and URL knowledge is in a single file:
[`src/content/d365-adapter.ts`](../src/content/d365-adapter.ts).

Everything else in the codebase — the recorder, the overlay widget, the
exporter, the tracker providers — is generic and does not know anything
about D365FO. This means you never have to touch more than this one file
(and its tests) when a selector drifts.

## The selector table

At the top of the adapter you will find:

```ts
export const D365_SELECTORS = {
  formTitle: [ '.Form-title', ... ],
  fieldLabelContainer: [ ':scope > .label', ... ],
  clickable: 'button, a[href], [role="button"], ...',
  errorBanner: [ '.messageBarError', ... ],
  userChip: [ '[aria-label^="Account manager"]', ... ],
} as const;
```

The arrays are ordered by preference: the resolver walks down the list
and stops at the first match. **Add new selectors at the top** so newer
D365FO releases take priority over legacy fallbacks. Never remove old
entries — users on older tenants rely on them.

## When a selector drifts: telemetry

The adapter does not throw or silently drop events when a selector misses.
Instead it emits a structured warning via the telemetry sink:

```ts
export type AdapterWarning = {
  kind: 'field-label' | 'form-title' | 'clickable';
  reason: string;
  sample?: string; // element signature like "input#name.journal"
};
```

The recorder wires a sink that appends the first occurrence of each
distinct warning to the current session as a `note` step, prefixed with
`[adapter-warning]`. This means a user whose recording silently fails on
a new D365FO release still sees *why* in the review page and can report
it without running the devtools.

To add new telemetry kinds, extend the `AdapterWarning` union and call
`warn()` at the drop point.

## Updating a selector

1. Open a D365FO tenant in a browser with devtools.
2. Find the element you care about (a form title, a field label, an
   error banner).
3. Note the new class names / attributes — prefer stable `aria-*` over
   generated class names.
4. Add the new selector at the **top** of the matching array in
   `D365_SELECTORS`. Never remove old entries.
5. Add a test fixture under `tests/unit/d365-adapter.test.ts` that asserts
   the new selector is recognised. Use an HTML snippet inside
   `document.body.innerHTML = '...'` rather than trying to scrape the
   whole page.
6. Run `npm test` and commit.

## Never do any of these

- Do not import DOM utilities into the recorder or the overlay. They
  stay generic.
- Do not throw on selector failure. The adapter always degrades
  gracefully.
- Do not use `innerText`. jsdom (used by the test suite) implements
  `textContent` but not `innerText`. Using `textContent` keeps tests and
  runtime behaviour identical.
- Do not key selectors on generated hash classes
  (`.sc-a1b2c3`, `.css-7fxg3`) — they change every build. Prefer
  `aria-*`, `role`, data attributes, or stable semantic class names.

## Testing against a real tenant

The mock page at `tests/fixtures/mock-d365.html` covers the happy path
for local development. For real-tenant regression testing:

1. Build: `npm run build`
2. Load the unpacked extension from `dist/`
3. Record a short session on each of: a list page, a details form, a
   dialog with validation errors.
4. Export the bundle and check `repro.xml` — every `<step>` should have
   a `formTitle`, clicks should have a human-readable `label`, and edits
   should have a `fieldLabel` that is not `(unlabeled field)`.

If anything shows `(unlabeled field)` or the telemetry notes an
adapter warning, update the selector table and add a corresponding
test.
