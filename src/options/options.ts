import { getOptions, setOptions, getTrackerSettings, setTrackerSettings } from '@shared/storage';
import type { RecordingOptions } from '@shared/types';
import { TRACKER_PROVIDERS, getProvider, applyDefaults } from '@shared/trackers';
import type { ConfigSchema, ConfigField, TrackerProvider } from '@shared/trackers';
import { applyI18n } from '@shared/i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(msg: string, error = false): void {
  const el = $<HTMLParagraphElement>('save-status');
  el.textContent = msg;
  el.style.color = error ? '#b91c1c' : '#047857';
}

// ----------------- tracker provider UI -----------------

function providerInputType(type: ConfigField['type']): string {
  switch (type) {
    case 'password':
      return 'password';
    case 'url':
      return 'url';
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    default:
      return 'text';
  }
}

function renderProviderForm(provider: TrackerProvider, config: Record<string, unknown>): void {
  const form = $<HTMLFormElement>('provider-form');
  form.innerHTML = '';

  const schema = provider.getConfigSchema();
  $<HTMLParagraphElement>('provider-intro').textContent = schema.intro ?? '';
  const docs = $<HTMLAnchorElement>('provider-docs');
  if (schema.docsUrl) {
    docs.href = schema.docsUrl;
    docs.hidden = false;
  } else {
    docs.hidden = true;
  }

  for (const field of schema.fields) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = field.label + (field.required ? ' *' : '');
    label.append(span);

    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (field.type === 'select') {
      const sel = document.createElement('select');
      for (const opt of field.options ?? []) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.append(o);
      }
      input = sel;
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      const inp = document.createElement('input');
      inp.type = providerInputType(field.type);
      if (field.placeholder) inp.placeholder = field.placeholder;
      input = inp;
    }
    input.name = field.key;
    input.id = `field-${field.key}`;

    const current = config[field.key];
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = current === true || current === 'true';
    } else if (current !== undefined && current !== null) {
      (input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value = String(current);
    }
    label.append(input);

    if (field.hint) {
      const hint = document.createElement('small');
      hint.className = 'hint';
      hint.textContent = field.hint;
      label.append(hint);
    }
    form.append(label);
  }
}

function readProviderForm(schema: ConfigSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const el = document.getElementById(`field-${field.key}`) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      out[field.key] = el.checked;
    } else if (el instanceof HTMLInputElement && el.type === 'number') {
      out[field.key] = el.value === '' ? undefined : Number(el.value);
    } else {
      out[field.key] = el.value;
    }
  }
  return out;
}

async function loadProviderUi(): Promise<void> {
  const select = $<HTMLSelectElement>('provider-select');
  select.innerHTML = '';
  for (const p of TRACKER_PROVIDERS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.displayName;
    select.append(o);
  }
  const settings = await getTrackerSettings();
  const initialId = settings.activeProviderId ?? TRACKER_PROVIDERS[0]!.id;
  select.value = initialId;
  showProvider(initialId, settings.providerConfigs[initialId] ?? {});
  select.addEventListener('change', async () => {
    const s = await getTrackerSettings();
    showProvider(select.value, s.providerConfigs[select.value] ?? {});
  });
}

function showProvider(id: string, config: Record<string, unknown>): void {
  const provider = getProvider(id);
  if (!provider) return;
  const schema = provider.getConfigSchema();
  const merged = applyDefaults(schema, config);
  renderProviderForm(provider, merged);
  updateActivateButton();
}

async function updateActivateButton(): Promise<void> {
  const settings = await getTrackerSettings();
  const selected = $<HTMLSelectElement>('provider-select').value;
  const btn = $<HTMLButtonElement>('btn-activate-provider');
  if (settings.activeProviderId === selected) {
    btn.textContent = 'Currently active';
    btn.disabled = true;
  } else {
    btn.textContent = 'Make active';
    btn.disabled = false;
  }
}

async function saveProvider(): Promise<void> {
  const id = $<HTMLSelectElement>('provider-select').value;
  const provider = getProvider(id);
  if (!provider) return;
  const config = readProviderForm(provider.getConfigSchema());
  const v = provider.validateConfig(config as Record<string, unknown>);
  if (!v.ok) {
    const errs = Object.values(v.errors ?? {}).join('; ');
    setStatus(`Validation failed: ${errs}`, true);
    return;
  }
  const settings = await getTrackerSettings();
  settings.providerConfigs[id] = config;
  if (!settings.activeProviderId) settings.activeProviderId = id;
  await setTrackerSettings(settings);
  setStatus(`${provider.displayName} settings saved.`);
  await updateActivateButton();
}

async function activateProvider(): Promise<void> {
  const id = $<HTMLSelectElement>('provider-select').value;
  const settings = await getTrackerSettings();
  settings.activeProviderId = id;
  // Make sure there is at least an empty config so submit() finds one
  if (!settings.providerConfigs[id]) settings.providerConfigs[id] = {};
  await setTrackerSettings(settings);
  setStatus(`${getProvider(id)?.displayName ?? id} is now the active tracker.`);
  await updateActivateButton();
}

async function testProvider(): Promise<void> {
  const id = $<HTMLSelectElement>('provider-select').value;
  const provider = getProvider(id);
  if (!provider) return;
  const config = readProviderForm(provider.getConfigSchema());
  setStatus('Testing connection...');
  try {
    const r = await provider.testConnection(config as Record<string, unknown>);
    if (r.ok) setStatus(`${provider.displayName}: ${r.message}`);
    else setStatus(`${provider.displayName}: ${r.message}`, true);
  } catch (e) {
    setStatus(`Test failed: ${(e as Error).message}`, true);
  }
}

// ----------------- recording options -----------------

async function loadOptions(): Promise<void> {
  const opts = await getOptions();
  ($<HTMLInputElement>('opt-auto-snap-nav')).checked = opts.autoSnapOnNavigate;
  ($<HTMLInputElement>('opt-auto-snap-error')).checked = opts.autoSnapOnError;
  ($<HTMLInputElement>('opt-auto-snap-click')).checked = opts.autoSnapOnClick;
  ($<HTMLInputElement>('opt-max-snaps')).value = String(opts.maxSnapshotsPerSession);
}

function readOptionsForm(): RecordingOptions {
  return {
    autoSnapOnNavigate: ($<HTMLInputElement>('opt-auto-snap-nav')).checked,
    autoSnapOnError: ($<HTMLInputElement>('opt-auto-snap-error')).checked,
    autoSnapOnClick: ($<HTMLInputElement>('opt-auto-snap-click')).checked,
    maxSnapshotsPerSession: Math.max(
      10,
      Math.min(1000, parseInt(($<HTMLInputElement>('opt-max-snaps')).value, 10) || 200),
    ),
  };
}

// ----------------- keyboard shortcuts (also handles issue #20) -----------------

async function loadShortcuts(): Promise<void> {
  const list = $<HTMLUListElement>('shortcuts-list');
  list.innerHTML = '';
  try {
    const cmds = await chrome.commands.getAll();
    if (cmds.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No commands registered.';
      list.append(li);
      return;
    }
    for (const c of cmds) {
      const li = document.createElement('li');
      li.className = 'shortcut-row';
      const hasBinding = Boolean(c.shortcut);
      const kbd = document.createElement('kbd');
      kbd.textContent = hasBinding ? c.shortcut! : '— not set —';
      if (!hasBinding) kbd.classList.add('missing');
      const desc = document.createElement('span');
      desc.className = 'shortcut-desc';
      desc.textContent = c.description ?? c.name ?? '';
      li.append(kbd, desc);
      if (!hasBinding) {
        const warn = document.createElement('span');
        warn.className = 'shortcut-warn';
        warn.textContent = '⚠ conflict or unset';
        warn.title = 'Another extension may have claimed this binding';
        li.append(warn);
      }
      list.append(li);
    }
  } catch (e) {
    const li = document.createElement('li');
    li.textContent = `Unable to read shortcuts: ${(e as Error).message}`;
    list.append(li);
  }
}

function openShortcutsSettings(e: MouseEvent): void {
  e.preventDefault();
  // Chromium-based browsers share the same internal URL, but chrome.tabs
  // will not open chrome:// URLs without the right permission. Using
  // chrome.tabs.update on a newly created blank tab works around this.
  const url = navigator.userAgent.includes('Edg') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
  void chrome.tabs.create({ url }).catch(() => {
    // Fallback: instruct user manually via alert if the browser forbids it
    alert(`Open ${url} in a new tab to customize shortcuts.`);
  });
}

// ----------------- wire up -----------------

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  void loadProviderUi();
  void loadOptions();
  void loadShortcuts();

  $<HTMLButtonElement>('btn-save-provider').addEventListener('click', () => void saveProvider());
  $<HTMLButtonElement>('btn-test-provider').addEventListener('click', () => void testProvider());
  $<HTMLButtonElement>('btn-activate-provider').addEventListener('click', () => void activateProvider());

  const remapLink = document.getElementById('remap-link') as HTMLAnchorElement | null;
  if (remapLink) remapLink.addEventListener('click', openShortcutsSettings);

  $<HTMLButtonElement>('btn-save-recording').addEventListener('click', async () => {
    try {
      await setOptions(readOptionsForm());
      setStatus('Recording options saved.');
    } catch (err) {
      setStatus((err as Error).message, true);
    }
  });
});
