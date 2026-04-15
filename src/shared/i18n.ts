/**
 * Tiny wrapper around chrome.i18n.getMessage so the UI code stays readable
 * and we can stub it from unit tests.
 *
 * Every user-facing string in the extension should flow through this helper.
 * Callers use the key as defined in _locales/<lang>/messages.json. If the
 * helper is invoked outside a Chromium extension context (e.g. in a unit
 * test where globalThis.chrome is a minimal stub), it returns the key
 * itself so the UI still renders something deterministic.
 */
export function t(key: string, substitutions?: string | string[]): string {
  try {
    const msg = chrome.i18n?.getMessage?.(key, substitutions);
    if (msg) return msg;
  } catch {
    // Fall through to the key fallback
  }
  return key;
}

/**
 * Populate every element with a data-i18n attribute by substituting its text
 * content. For inputs / textareas, the attribute can be written as
 * data-i18n-placeholder to target the placeholder instead.
 *
 * Call this once on DOMContentLoaded. It is idempotent.
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && 'placeholder' in el) (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
}
