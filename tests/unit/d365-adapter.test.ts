import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseUrl,
  getFormTitle,
  resolveFieldLabel,
  resolveClickable,
  isEditableField,
  getFieldValue,
  observeErrors,
} from '../../src/content/d365-adapter';

describe('parseUrl', () => {
  it('extracts menuItem, company, and language from a D365FO URL', () => {
    const info = parseUrl('https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable&lng=en-us');
    expect(info.host).toBe('usmf.dynamics.com');
    expect(info.tenant).toBe('usmf');
    expect(info.menuItem).toBe('LedgerJournalTable');
    expect(info.company).toBe('USMF');
    expect(info.language).toBe('en-us');
  });

  it('returns undefined for absent parameters rather than empty strings', () => {
    const info = parseUrl('https://example.dynamics.com/');
    expect(info.menuItem).toBeUndefined();
    expect(info.company).toBeUndefined();
    expect(info.language).toBeUndefined();
  });
});

describe('getFormTitle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads from .Form-title when present', () => {
    document.body.innerHTML = '<div class="Form-title">General journal entries</div>';
    expect(getFormTitle()).toBe('General journal entries');
  });

  it('falls back to AppBarTitle-content', () => {
    document.body.innerHTML = '<div class="AppBarTitle-content">Customer details</div>';
    expect(getFormTitle()).toBe('Customer details');
  });

  it('falls back to document.title if no selector matches', () => {
    document.title = 'Fallback title';
    expect(getFormTitle()).toBe('Fallback title');
  });
});

describe('resolveFieldLabel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers aria-label', () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Journal name');
    document.body.append(input);
    expect(resolveFieldLabel(input)).toBe('Journal name');
  });

  it('resolves via associated <label for>', () => {
    document.body.innerHTML = '<label for="acct">Account</label><input id="acct" />';
    const input = document.getElementById('acct') as HTMLInputElement;
    expect(resolveFieldLabel(input)).toBe('Account');
  });

  it('resolves via aria-labelledby', () => {
    document.body.innerHTML = '<span id="lbl">Amount due</span><input aria-labelledby="lbl" />';
    const input = document.querySelector('input') as HTMLInputElement;
    expect(resolveFieldLabel(input)).toBe('Amount due');
  });

  it('walks up looking for a sibling label container', () => {
    document.body.innerHTML = `
      <div class="field">
        <span class="label">Currency</span>
        <input />
      </div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    expect(resolveFieldLabel(input)).toBe('Currency');
  });

  it('falls back to placeholder wrapped in parens', () => {
    const input = document.createElement('input');
    input.placeholder = 'Enter SKU';
    document.body.append(input);
    expect(resolveFieldLabel(input)).toBe('(Enter SKU)');
  });

  it('returns undefined when nothing resolves', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(resolveFieldLabel(input)).toBeUndefined();
  });
});

describe('resolveClickable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the nearest button and returns its label', () => {
    document.body.innerHTML = '<button aria-label="Post">Post</button>';
    const btn = document.querySelector('button')!;
    expect(resolveClickable(btn)).toEqual({ label: 'Post', role: 'button' });
  });

  it('walks up from a nested span to the containing button', () => {
    document.body.innerHTML = '<button><span>New</span></button>';
    const span = document.querySelector('span')!;
    const found = resolveClickable(span);
    expect(found?.label).toBe('New');
  });

  it('resolves role=menuitem without a button tag', () => {
    document.body.innerHTML = '<div role="menuitem" aria-label="Open voucher">x</div>';
    const div = document.querySelector('[role=menuitem]')!;
    expect(resolveClickable(div)).toEqual({ label: 'Open voucher', role: 'menuitem' });
  });

  it('returns null when nothing clickable is found', () => {
    document.body.innerHTML = '<div><p>plain text</p></div>';
    const p = document.querySelector('p')!;
    expect(resolveClickable(p)).toBeNull();
  });
});

describe('isEditableField', () => {
  it('accepts text, select, textarea', () => {
    const text = document.createElement('input');
    const sel = document.createElement('select');
    const ta = document.createElement('textarea');
    expect(isEditableField(text)).toBe(true);
    expect(isEditableField(sel)).toBe(true);
    expect(isEditableField(ta)).toBe(true);
  });

  it('rejects buttons and hidden inputs', () => {
    const btn = document.createElement('input');
    btn.type = 'button';
    expect(isEditableField(btn)).toBe(false);
    const hid = document.createElement('input');
    hid.type = 'hidden';
    expect(isEditableField(hid)).toBe(false);
  });
});

describe('getFieldValue', () => {
  it('reads checkbox as string boolean', () => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = true;
    expect(getFieldValue(c)).toBe('true');
    c.checked = false;
    expect(getFieldValue(c)).toBe('false');
  });

  it('reads select option text, not value', () => {
    const s = document.createElement('select');
    const o1 = document.createElement('option');
    o1.value = 'USD';
    o1.text = 'US Dollar';
    s.append(o1);
    s.value = 'USD';
    expect(getFieldValue(s)).toBe('US Dollar');
  });
});

describe('observeErrors', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fires when a messageBarError element appears', async () => {
    const seen: string[] = [];
    const obs = observeErrors((msg) => seen.push(msg));
    const err = document.createElement('div');
    err.className = 'messageBarError';
    err.textContent = 'Account X is not valid for posting.';
    document.body.append(err);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toContain('Account X is not valid for posting.');
    obs.stop();
  });

  it('does not fire twice for the same message text', async () => {
    const seen: string[] = [];
    const obs = observeErrors((msg) => seen.push(msg));
    const err = document.createElement('div');
    err.className = 'messageBarError';
    err.textContent = 'duplicate';
    document.body.append(err);
    await new Promise((r) => setTimeout(r, 10));
    // mutate the same node's class to trigger attribute mutation
    err.className = 'messageBarError foo';
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.filter((m) => m === 'duplicate')).toHaveLength(1);
    obs.stop();
  });
});
