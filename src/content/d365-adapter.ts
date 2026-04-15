/**
 * D365FO-specific DOM and URL knowledge lives here. Keep everything else generic
 * so the recorder can be adapted to other apps with a sibling adapter.
 *
 * Selectors and patterns are based on the public D365FO Unified Operations UI
 * as of 2024-2026 (wcf forms, dyn controls, message bars). They are intentionally
 * permissive: when a selector misses, we fall back to a generic strategy so a
 * recording never silently loses an event.
 */

export interface UrlInfo {
  host: string;
  tenant?: string;
  menuItem?: string;
  company?: string;
  language?: string;
  url: string;
}

export function parseUrl(url: string): UrlInfo {
  const u = new URL(url);
  const q = u.searchParams;
  // D365FO examples:
  //   ?cmp=USMF&mi=LedgerJournalTable&lng=en-us
  //   ?cmp=USMF&mi=action:CustTableListPage
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

/**
 * D365FO renders the active form title inside a specific header element. We
 * try a few known selectors and fall back to document.title.
 */
export function getFormTitle(): string | undefined {
  const candidates = [
    '.Form-title',
    '.form-title',
    '[role="banner"] h1',
    '.AppBarTitle-content',
    '.AppBarHeaderTitle',
  ];
  for (const sel of candidates) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  const title = document.title?.trim();
  return title || undefined;
}

/**
 * Resolve the human-visible label for an input-like element. Strategy:
 *   1. aria-label
 *   2. aria-labelledby -> id lookup
 *   3. associated <label for="id">
 *   4. nearest ancestor with .label or [class*="FieldLabel"]
 *   5. preceding sibling span in D365FO field container
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
    const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${safeId}"]`);
    const t = lbl?.textContent?.trim();
    if (t) return t;
  }

  // Walk up looking for a D365FO field-container with a label child
  let node: HTMLElement | null = el;
  for (let i = 0; i < 6 && node; i++) {
    const labelEl = node.querySelector<HTMLElement>(':scope > .label, :scope > [class*="FieldLabel"], :scope > .labelWrapper');
    const t = labelEl?.textContent?.trim();
    if (t) return t;
    node = node.parentElement;
  }

  // Last resort: placeholder
  const ph = (el as HTMLInputElement).placeholder?.trim();
  if (ph) return `(${ph})`;

  return undefined;
}

/**
 * Resolve the accessible name of a clicked element. Walks up to 5 ancestors
 * looking for a meaningful "clickable" — button, link, menu item, tile.
 */
export function resolveClickable(target: EventTarget | null): { label: string; role?: string } | null {
  if (!(target instanceof Element)) return null;
  let el: Element | null = target;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    if (
      el.matches('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="link"], .button, .menuItem, .dyn-button, .dynamicsTile')
    ) {
      const label =
        el.getAttribute('aria-label')?.trim() ||
        (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) ||
        el.getAttribute('title')?.trim() ||
        el.getAttribute('name')?.trim() ||
        '';
      if (!label) continue;
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
      return { label, role };
    }
  }
  return null;
}

export function isEditableField(el: EventTarget | null): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
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

/**
 * Message bar detection. D365FO shows errors in .messageBarError / .notification-error.
 * We watch mutations on body and emit the first meaningful text.
 */
export interface ErrorObserver {
  stop(): void;
}

export function observeErrors(onError: (message: string) => void): ErrorObserver {
  const seen = new Set<string>();
  const ERR_SELECTORS = [
    '.messageBarError',
    '.notificationMessages .error',
    '[class*="MessageBar"][class*="Error"]',
    '[class*="notification"][class*="error"]',
    '[role="alert"]',
  ].join(',');

  function emit(n: HTMLElement): void {
    const text = n.textContent?.trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    onError(text);
  }

  function scan(root: ParentNode): void {
    if (root instanceof HTMLElement && root.matches(ERR_SELECTORS)) emit(root);
    const nodes = root.querySelectorAll<HTMLElement>(ERR_SELECTORS);
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
  obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  return { stop: () => obs.disconnect() };
}

/**
 * Best-effort: read the current user name from the top-right user chip.
 */
export function getCurrentUser(): string | undefined {
  const el = document.querySelector<HTMLElement>(
    '[aria-label^="Account manager"], [aria-label^="Benutzer"], .userTile, [class*="UserTile"]',
  );
  return el?.textContent?.trim() || undefined;
}
