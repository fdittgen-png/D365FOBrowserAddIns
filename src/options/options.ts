import { getOtrsConfig, setOtrsConfig, getOptions, setOptions } from '@shared/storage';
import type { OtrsConfig, RecordingOptions } from '@shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(msg: string, error = false): void {
  const el = $<HTMLParagraphElement>('save-status');
  el.textContent = msg;
  el.style.color = error ? '#b91c1c' : '#047857';
}

async function loadOtrs(): Promise<void> {
  const cfg = await getOtrsConfig();
  if (!cfg) return;
  ($<HTMLInputElement>('otrs-url')).value = cfg.baseUrl;
  ($<HTMLInputElement>('otrs-webservice')).value = cfg.webservice;
  ($<HTMLInputElement>('otrs-user')).value = cfg.user;
  ($<HTMLInputElement>('otrs-password')).value = cfg.password;
  ($<HTMLInputElement>('otrs-queue')).value = cfg.queue;
  ($<HTMLInputElement>('otrs-type')).value = cfg.type;
  ($<HTMLSelectElement>('otrs-priority')).value = cfg.priority;
  ($<HTMLInputElement>('otrs-state')).value = cfg.state;
}

function readOtrsForm(): OtrsConfig {
  return {
    baseUrl: ($<HTMLInputElement>('otrs-url')).value.trim(),
    webservice: ($<HTMLInputElement>('otrs-webservice')).value.trim(),
    user: ($<HTMLInputElement>('otrs-user')).value.trim(),
    password: ($<HTMLInputElement>('otrs-password')).value,
    queue: ($<HTMLInputElement>('otrs-queue')).value.trim(),
    type: ($<HTMLInputElement>('otrs-type')).value.trim() || 'Incident',
    priority: ($<HTMLSelectElement>('otrs-priority')).value,
    state: ($<HTMLInputElement>('otrs-state')).value.trim() || 'new',
  };
}

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
    maxSnapshotsPerSession: Math.max(10, Math.min(1000, parseInt(($<HTMLInputElement>('opt-max-snaps')).value, 10) || 200)),
  };
}

document.addEventListener('DOMContentLoaded', () => {
  void loadOtrs();
  void loadOptions();

  $<HTMLFormElement>('otrs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await setOtrsConfig(readOtrsForm());
      setStatus('OTRS settings saved.');
    } catch (err) {
      setStatus((err as Error).message, true);
    }
  });

  $<HTMLButtonElement>('btn-test').addEventListener('click', async () => {
    const cfg = readOtrsForm();
    if (!cfg.baseUrl) { setStatus('Base URL is required', true); return; }
    try {
      const origin = new URL(cfg.baseUrl).origin + '/*';
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) { setStatus('Host permission denied — cannot reach OTRS', true); return; }
      const url = `${cfg.baseUrl.replace(/\/$/, '')}/otrs/nph-genericinterface.pl/Webservice/${encodeURIComponent(cfg.webservice)}/SessionCreate`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserLogin: cfg.user, Password: cfg.password }),
      });
      const text = await resp.text();
      if (resp.ok) setStatus(`Reached OTRS (HTTP ${resp.status}). Response: ${text.slice(0, 120)}`);
      else setStatus(`OTRS responded HTTP ${resp.status}: ${text.slice(0, 200)}`, true);
    } catch (err) {
      setStatus(`Test failed: ${(err as Error).message}`, true);
    }
  });

  $<HTMLButtonElement>('btn-save-recording').addEventListener('click', async () => {
    try {
      await setOptions(readOptionsForm());
      setStatus('Recording options saved.');
    } catch (err) {
      setStatus((err as Error).message, true);
    }
  });
});
