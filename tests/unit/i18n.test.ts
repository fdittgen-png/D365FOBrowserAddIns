import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { t, applyI18n } from '@shared/i18n';

describe('t()', () => {
  afterEach(() => {
    (globalThis as unknown as { chrome: { i18n?: unknown } }).chrome = {
      ...(globalThis as unknown as { chrome: object }).chrome,
      i18n: undefined,
    };
  });

  it('returns the key when chrome.i18n is not available', () => {
    expect(t('popupStart')).toBe('popupStart');
  });

  it('delegates to chrome.i18n.getMessage when present', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      ...(globalThis as unknown as { chrome: object }).chrome,
      i18n: { getMessage: vi.fn().mockImplementation((k: string) => (k === 'popupStart' ? 'Aufnahme starten' : '')) },
    };
    expect(t('popupStart')).toBe('Aufnahme starten');
  });

  it('falls back to key when getMessage returns empty string', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      ...(globalThis as unknown as { chrome: object }).chrome,
      i18n: { getMessage: () => '' },
    };
    expect(t('popupStart')).toBe('popupStart');
  });
});

describe('applyI18n', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as unknown as { chrome: unknown }).chrome = {
      ...(globalThis as unknown as { chrome: object }).chrome,
      i18n: { getMessage: (k: string) => ({ helloKey: 'Hello', placeKey: 'type here', ariaKey: 'close' } as Record<string, string>)[k] ?? '' },
    };
  });

  it('replaces textContent for data-i18n elements', () => {
    document.body.innerHTML = '<h1 data-i18n="helloKey">placeholder</h1>';
    applyI18n();
    expect(document.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('replaces placeholder for data-i18n-placeholder inputs', () => {
    document.body.innerHTML = '<input data-i18n-placeholder="placeKey" placeholder="old" />';
    applyI18n();
    expect((document.querySelector('input') as HTMLInputElement).placeholder).toBe('type here');
  });

  it('replaces aria-label for data-i18n-aria-label elements', () => {
    document.body.innerHTML = '<button data-i18n-aria-label="ariaKey">X</button>';
    applyI18n();
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('close');
  });
});
