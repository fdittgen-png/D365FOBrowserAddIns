import { send, onMessage } from '@shared/messaging';
import type { Message, MessageResponse, Environment, Session } from '@shared/types';
import { EXT_VERSION } from '@shared/types';
import {
  parseUrl,
  getFormTitle,
  resolveFieldLabel,
  resolveClickable,
  isEditableField,
  getFieldValue,
  observeErrors,
  getCurrentUser,
} from './d365-adapter';
import { mountOverlay, OverlayHandle } from './overlay';

/**
 * Content script. Lifecycle:
 *   - injected at document_idle on every D365FO page (including after AAD redirect)
 *   - on load, asks the background for current session state
 *   - if recording, attaches listeners and mounts the overlay
 *   - emits STEP_EVENT messages for each observed user action
 *   - handles POPUP_START messages (user started from popup) and STATE_UPDATE
 *     broadcasts from the background so the overlay stays in sync
 *
 * This script is idempotent: if the page reloads mid-session (e.g. AAD redirect),
 * the background still holds the session and the content script reconnects.
 */

const PAGE_HOOK_SRC = chrome.runtime.getURL('content/page-hook.js');

let overlay: OverlayHandle | null = null;
let listenersAttached = false;
let errorObserverStop: (() => void) | null = null;
let lastNavigationUrl = '';
let recording = false;
let paused = false;

// field edit capture state: focused element + snapshot of its value on focus
let focusEl: HTMLElement | null = null;
let focusValue = '';
const pendingEdits = new Map<HTMLElement, number>();

// --------------- environment snapshot ---------------

function snapshotEnvironment(): Environment {
  const info = parseUrl(location.href);
  return {
    url: info.url,
    host: info.host,
    tenant: info.tenant,
    company: info.company,
    legalEntity: info.company,
    language: info.language,
    userAgent: navigator.userAgent,
    extensionVersion: EXT_VERSION,
    capturedAt: Date.now(),
  };
}

// --------------- page-hook injection ---------------

function injectPageHook(): void {
  if (document.getElementById('d365-repro-page-hook')) return;
  const script = document.createElement('script');
  script.id = 'd365-repro-page-hook';
  script.src = PAGE_HOOK_SRC;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// --------------- event handlers ---------------

function handleClick(ev: MouseEvent): void {
  if (!recording || paused) return;
  // ignore clicks inside our own overlay
  if ((ev.target as Element | null)?.closest?.('#d365-repro-overlay-host')) return;
  const found = resolveClickable(ev.target);
  if (!found) return;
  const formTitle = getFormTitle();
  void send({
    type: 'STEP_EVENT',
    step: { kind: 'click', label: found.label, role: found.role, formTitle } as unknown as Message extends { type: 'STEP_EVENT'; step: infer S } ? S : never,
  });
}

function handleFocusIn(ev: FocusEvent): void {
  if (!recording || paused) return;
  const t = ev.target;
  if (!isEditableField(t)) return;
  focusEl = t;
  focusValue = getFieldValue(t);
}

function handleFocusOut(ev: FocusEvent): void {
  if (!recording || paused) return;
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  if (t !== focusEl) return;
  commitEdit(t);
  focusEl = null;
  focusValue = '';
}

function handleChange(ev: Event): void {
  if (!recording || paused) return;
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  // debounce: one commit per blur, but also commit on `change` for selects/checkboxes
  if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && ['checkbox', 'radio', 'date'].includes(t.type))) {
    commitEdit(t);
  } else {
    // debounce 600ms for text inputs in case blur doesn't fire
    const existing = pendingEdits.get(t);
    if (existing) clearTimeout(existing);
    pendingEdits.set(t, window.setTimeout(() => commitEdit(t), 600));
  }
}

function commitEdit(el: HTMLElement): void {
  const t = pendingEdits.get(el);
  if (t) { clearTimeout(t); pendingEdits.delete(el); }
  const newValue = getFieldValue(el);
  if (newValue === focusValue) return;
  const label = resolveFieldLabel(el) ?? '(unlabeled field)';
  void send({
    type: 'STEP_EVENT',
    step: {
      kind: 'edit',
      fieldLabel: label,
      oldValue: focusValue,
      newValue,
      formTitle: getFormTitle(),
    } as unknown as never,
  });
  focusValue = newValue;
}

function handleNavigate(): void {
  if (!recording || paused) return;
  const url = location.href;
  if (url === lastNavigationUrl) return;
  lastNavigationUrl = url;
  const info = parseUrl(url);
  // Delay slightly so getFormTitle has rendered content
  setTimeout(() => {
    void send({
      type: 'STEP_EVENT',
      step: {
        kind: 'navigate',
        url,
        menuItem: info.menuItem,
        company: info.company,
        formTitle: getFormTitle(),
      } as unknown as never,
    });
  }, 150);
}

// --------------- lifecycle ---------------

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('focusout', handleFocusOut, true);
  document.addEventListener('change', handleChange, true);
  window.addEventListener('d365-repro:navigate', handleNavigate as EventListener);
  errorObserverStop = observeErrors((message) => {
    if (!recording || paused) return;
    void send({ type: 'ERROR_DETECTED', message, formTitle: getFormTitle() });
  }).stop as unknown as () => void;
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('focusin', handleFocusIn, true);
  document.removeEventListener('focusout', handleFocusOut, true);
  document.removeEventListener('change', handleChange, true);
  window.removeEventListener('d365-repro:navigate', handleNavigate as EventListener);
  if (errorObserverStop) { errorObserverStop(); errorObserverStop = null; }
}

function ensureOverlay(): OverlayHandle {
  if (overlay) return overlay;
  overlay = mountOverlay({
    onSnapshot: () => void send({ type: 'REQUEST_SNAPSHOT', reason: 'manual' }),
    onAddNote: (text) => void send({ type: 'STEP_EVENT', step: { kind: 'note', text } as unknown as never }),
    onPause: () => void send({ type: 'SESSION_PAUSE' }),
    onResume: () => void send({ type: 'SESSION_RESUME' }),
    onStop: () => void send({ type: 'SESSION_STOP' }),
  });
  return overlay;
}

async function startRecording(): Promise<void> {
  injectPageHook();
  const env = snapshotEnvironment();
  // best-effort: stash user on the environment object (not part of the type, but stored in description metadata)
  const user = getCurrentUser();
  const resp = await send<Session>({
    type: 'SESSION_START',
    env: { ...env, ...(user ? { host: env.host + ` (${user})` } : {}) },
  });
  if (!resp.ok) {
    console.warn('[repro] session start failed', resp.error);
    return;
  }
  recording = true;
  paused = false;
  lastNavigationUrl = location.href;
  attachListeners();
  const h = ensureOverlay();
  h.setState('recording', 0);
  // Emit an initial navigate step so the recording starts with context
  void send({
    type: 'STEP_EVENT',
    step: {
      kind: 'navigate',
      url: location.href,
      menuItem: parseUrl(location.href).menuItem,
      company: parseUrl(location.href).company,
      formTitle: getFormTitle(),
    } as unknown as never,
  });
}

async function reconnectIfActive(): Promise<void> {
  const resp = await send<Session | null>({ type: 'POPUP_GET_STATE' });
  if (!resp.ok || !resp.data) return;
  const session = resp.data;
  if (session.state !== 'recording' && session.state !== 'paused') return;
  // Session is alive (likely a redirect/reload) — reattach
  injectPageHook();
  recording = true;
  paused = session.state === 'paused';
  lastNavigationUrl = location.href;
  attachListeners();
  ensureOverlay().setState(session.state, session.steps.length);
  // Emit a navigate step so the reconnect is visible in the timeline
  void send({
    type: 'STEP_EVENT',
    step: {
      kind: 'navigate',
      url: location.href,
      menuItem: parseUrl(location.href).menuItem,
      company: parseUrl(location.href).company,
      formTitle: getFormTitle(),
      note: '[auto] reconnected after navigation',
    } as unknown as never,
  });
}

// --------------- inbound messages ---------------

onMessage(async (msg: Message): Promise<MessageResponse> => {
  switch (msg.type) {
    case 'POPUP_START':
      if (!recording) await startRecording();
      return { ok: true };
    case 'STATE_UPDATE':
      recording = msg.state === 'recording' || msg.state === 'paused';
      paused = msg.state === 'paused';
      if (recording) {
        attachListeners();
        ensureOverlay().setState(msg.state as 'recording' | 'paused', msg.stepCount);
      } else {
        detachListeners();
        if (overlay) { overlay.destroy(); overlay = null; }
      }
      return { ok: true };
    default:
      return { ok: true };
  }
});

// Entry point
void reconnectIfActive();
