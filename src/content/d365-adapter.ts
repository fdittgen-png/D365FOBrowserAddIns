/**
 * D365FO-specific DOM and URL knowledge lives here. Keep everything else
 * generic so the recorder can be adapted to other apps with a sibling adapter.
 *
 * Every selector the adapter uses is declared in the D365_SELECTORS constant
 * below. Breaking one of those only produces a warning via the telemetry
 * callback; it never throws or silently drops an event. See
 * docs/d365-adapter.md for the process for updating selectors when
 * Microsoft ships a D365FO UI change.
 */

export interface UrlInfo {
  host: string;
  tenant?: string;
  menuItem?: string;
  company?: string;
  language?: string;
  url: string;
}

/**
 * Central selector table. Ordered by preference — the resolver walks down
 * the list and stops at the first match. Add new selectors at the TOP so
 * newer D365FO releases take priority over legacy fallbacks.
 */
export const D365_SELECTORS = {
  formTitle: [
    '.Form-title',
    '.form-title',
    '[role="banner"] h1',
    '.AppBarTitle-content',
    '.AppBarHeaderTitle',
  ],
  fieldLabelContainer: [
    ':scope > .label',
    ':scope > [class*="FieldLabel"]',
    ':scope > .labelWrapper',
  ],
  clickable:
    'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="link"], .button, .menuItem, .dyn-button, .dynamicsTile',
  errorBanner: [
    '.messageBarError',
    '.notificationMessages .error',
    '[class*="MessageBar"][class*="Error"]',
    '[class*="notification"][class*="error"]',
    '[role="alert"]',
  ],
  userChip: [
    '[aria-label^="Account manager"]',
    '[aria-label^="Benutzer"]',
    '.userTile',
    '[class*="UserTile"]',
  ],
} as const;

// ----------------- telemetry -----------------

export type AdapterWarning = {
  kind: 'field-label' | 'form-title' | 'clickable';
  reason: string;
  sample?: string;
};

let warningSink: ((w: AdapterWarning) => void) | null = null;

/**
 * Wire a callback that fires whenever the adapter falls through every
 * selector strategy it knows about and has to give up. The recorder
 * forwards these into the session as warning steps so users can report
 * them without manual bug-filing.
 */
export function setAdapterWarningSink(sink: ((w: AdapterWarning) => void) | null): void {
  warningSink = sink;
}

function warn(w: AdapterWarning): void {
  if (warningSink) warningSink(w);
}

// ----------------- url parsing -----------------

export function parseUrl(url: string): UrlInfo {
  const u = new URL(url);
  const q = u.searchParams;
  const mi = q.get('mi') ?? undefined;
  const cmp = q.get('cmp') ?? undefined;
  const lng = q.get('lng') ?? undefined;
  return {
    host: u.host,
    tenant: u.host.split('.')[0],
    menuItem: mi,
    company: cmp,
    language: lng,
    url,
  };
}

// ----------------- form title -----------------

export function getFormTitle(): string | undefined {
  for (const sel of D365_SELECTORS.formTitle) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  const title = document.title?.trim();
  if (title) return title;
  warn({ kind: 'form-title', reason: 'no selector matched and document.title is empty' });
  return undefined;
}

// ----------------- field labels -----------------

/**
 * Resolve the human-visible label for an input-like element. Strategy:
 *   1. aria-label
 *   2. aria-labelledby -> id lookup
 *   3. associated <label for="id">
 *   4. nearest ancestor with a D365FO field-label container child
 *   5. placeholder (wrapped in parens)
 */
export function resolveFieldLabel(el: HTMLElement): string | undefined {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    const t = ref?.textContent?.trim();
    if (t) return t;
  }

  const id = el.id;
  if (id) {
    const safeId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : id.replace(/["\\]/g, '\\$&');
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${safeId}"]`);
    const t = lbl?.textContent?.trim();
    if (t) return t;
  }

  const containerSelector = D365_SELECTORS.fieldLabelContainer.join(',');
  let node: HTMLElement | null = el;
  for (let i = 0; i < 6 && node; i++) {
    const labelEl = node.querySelector<HTMLElement>(containerSelector);
    const t = labelEl?.textContent?.trim();
    if (t) return t;
    node = node.parentElement;
  }

  const ph = (el as HTMLInputElement).placeholder?.trim();
  if (ph) return `(${ph})`;

  warn({
    kind: 'field-label',
    reason: 'no aria-label, no label-for, no D365 label container, no placeholder',
    sample: elementSignature(el),
  });
  return undefined;
}

// ----------------- clickables -----------------

export function resolveClickable(target: EventTarget | null): { label: string; role?: string } | null {
  if (!(target instanceof Element)) return null;
  let el: Element | null = target;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    if (el.matches(D365_SELECTORS.clickable)) {
      const label =
        el.getAttribute('aria-label')?.trim() ||
        (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) ||
        el.getAttribute('title')?.trim() ||
        el.getAttribute('name')?.trim() ||
        '';
      if (!label) {
        warn({
          kind: 'clickable',
          reason: 'matched clickable selector but no text/aria-label/title',
          sample: elementSignature(el),
        });
        continue;
      }
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
      return { label, role };
    }
  }
  return null;
}

// ----------------- editable detection -----------------

export function isEditableField(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    return !['button', 'submit', 'reset', 'image', 'hidden'].includes(t);
  }
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
}

export function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'true' : 'false';
    return el.value ?? '';
  }
  if (el instanceof HTMLSelectElement) {
    return el.selectedOptions[0]?.text ?? el.value ?? '';
  }
  if (el instanceof HTMLTextAreaElement) return el.value ?? '';
  if (el.isContentEditable) return el.textContent ?? '';
  return '';
}

// ----------------- error banner observation -----------------

export interface ErrorObserver {
  stop(): void;
}

export function observeErrors(onError: (message: string) => void): ErrorObserver {
  const seen = new Set<string>();
  const selector = D365_SELECTORS.errorBanner.join(',');

  function emit(n: HTMLElement): void {
    const text = n.textContent?.trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    onError(text);
  }

  function scan(root: ParentNode): void {
    if (root instanceof HTMLElement && root.matches(selector)) emit(root);
    const nodes = root.querySelectorAll<HTMLElement>(selector);
    nodes.forEach(emit);
  }

  scan(document);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n instanceof Element) scan(n);
      });
      if (m.target instanceof Element && m.type === 'attributes') scan(m.target);
    }
  });
  obs.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  return { stop: () => obs.disconnect() };
}

// ----------------- user chip -----------------

export function getCurrentUser(): string | undefined {
  const el = document.querySelector<HTMLElement>(D365_SELECTORS.userChip.join(','));
  return el?.textContent?.trim() || undefined;
}

// ----------------- helpers -----------------

function elementSignature(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 3).join('.')}` : '';
  return `${tag}${id}${cls}`.slice(0, 80);
}
