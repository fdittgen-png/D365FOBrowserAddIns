import { onMessage, uid, sendToTab } from '@shared/messaging';
import {
  getActiveSession,
  setActiveSession,
  putSnapshot,
  getSnapshot,
  archiveSession,
  getArchivedSession,
  getOptions,
  getTrackerSettings,
} from '@shared/storage';
import type {
  Message,
  MessageResponse,
  Session,
  Step,
  Environment,
  SnapshotBlob,
} from '@shared/types';
import { EXT_VERSION } from '@shared/types';
import { exportSessionAsZip } from '@shared/exporter';
import { getProvider, TRACKER_PROVIDERS } from '@shared/trackers';
import { collectAttachments } from '@shared/trackers/common';
import { captureFullPage } from './full-page-capture';

// ----------------- capture throttle -----------------

const CAPTURE_MIN_GAP_MS = 700;
let lastCaptureAt = 0;
let captureBusy = false;
const captureQueue: Array<() => void> = [];

function drainQueue(): void {
  if (captureBusy) return;
  const next = captureQueue.shift();
  if (next) next();
}

async function captureForTab(tabId: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const run = async () => {
      captureBusy = true;
      try {
        const gap = Date.now() - lastCaptureAt;
        if (gap < CAPTURE_MIN_GAP_MS) {
          await new Promise((r) => setTimeout(r, CAPTURE_MIN_GAP_MS - gap));
        }
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab || tab.windowId == null) return resolve(null);

        const opts = await getOptions();
        if (opts.captureStrategy === 'viewport') {
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          lastCaptureAt = Date.now();
          const resp = await fetch(dataUrl);
          const blob = await resp.blob();
          resolve(blob);
          return;
        }
        // Full-page strategies — scroll stitching or debugger protocol
        const blob = await captureFullPage({ tabId, strategy: opts.captureStrategy });
        lastCaptureAt = Date.now();
        resolve(blob);
      } catch (e) {
        console.warn('[repro] capture failed', e);
        resolve(null);
      } finally {
        captureBusy = false;
        drainQueue();
      }
    };
    captureQueue.push(run);
    drainQueue();
  });
}

// ----------------- session helpers -----------------

function freshSession(tabId: number, env: Environment): Session {
  return {
    id: uid('ses'),
    tabId,
    state: 'recording',
    startedAt: Date.now(),
    title: '',
    description: '',
    severity: 'med',
    tags: [],
    environment: env,
    steps: [],
  };
}

async function appendStep(session: Session, raw: Omit<Step, 'id' | 'ts'> & { kind: Step['kind'] }): Promise<Step> {
  const step = { ...(raw as Step), id: uid('st'), ts: Date.now() } as Step;
  session.steps.push(step);
  await setActiveSession(session);
  await broadcastState(session);
  return step;
}

async function broadcastState(session: Session | null): Promise<void> {
  if (!session) return;
  await sendToTab(session.tabId, {
    type: 'STATE_UPDATE',
    state: session.state,
    sessionId: session.id,
    stepCount: session.steps.length,
  });
}

function countScreenshots(session: Session): number {
  return session.steps.reduce((n, s) => n + (('screenshotId' in s && s.screenshotId) ? 1 : 0), 0);
}

async function snapshotAndAttach(session: Session, stepId?: string): Promise<string | null> {
  const opts = await getOptions();
  if (countScreenshots(session) >= opts.maxSnapshotsPerSession) {
    console.warn('[repro] snapshot cap reached');
    return null;
  }
  const blob = await captureForTab(session.tabId);
  if (!blob) return null;
  const snap: SnapshotBlob = {
    id: uid('img'),
    sessionId: session.id,
    ts: Date.now(),
    mime: 'image/png',
    data: blob,
  };
  await putSnapshot(snap);
  // attach to the requested step, or the latest step that supports screenshots
  const target = stepId
    ? session.steps.find((s) => s.id === stepId)
    : [...session.steps].reverse().find((s) => 'screenshotId' in s);
  if (target && 'screenshotId' in target) {
    (target as { screenshotId?: string }).screenshotId = snap.id;
    await setActiveSession(session);
  }
  return snap.id;
}

// ----------------- message router -----------------

onMessage(async (msg: Message, sender): Promise<MessageResponse> => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'SESSION_START': {
      if (tabId == null) return { ok: false, error: 'no-tab' };
      const existing = await getActiveSession();
      if (existing && existing.state === 'recording') {
        return { ok: true, data: existing };
      }
      const env: Environment = { ...msg.env, extensionVersion: EXT_VERSION };
      const session = freshSession(tabId, env);
      await setActiveSession(session);
      await broadcastState(session);
      return { ok: true, data: session };
    }

    case 'POPUP_START': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'no-active-tab' };
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'STATE_UPDATE', state: 'recording', stepCount: 0 } satisfies Message);
      } catch {
        return { ok: false, error: 'content-script-not-loaded (open a D365FO tab)' };
      }
      // Content script itself calls SESSION_START after gathering env.
      await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_START' } satisfies Message).catch(() => undefined);
      return { ok: true };
    }

    case 'POPUP_STOP':
    case 'SESSION_STOP': {
      const session = await getActiveSession();
      if (!session) return { ok: false, error: 'no-session' };
      session.state = 'stopped';
      session.endedAt = Date.now();
      await archiveSession(session);
      await setActiveSession(null);
      await broadcastState({ ...session, state: 'idle' });
      // Open review tab
      const reviewUrl = chrome.runtime.getURL(`review/review.html#${session.id}`);
      await chrome.tabs.create({ url: reviewUrl });
      return { ok: true, data: { sessionId: session.id } };
    }

    case 'POPUP_PAUSE':
    case 'SESSION_PAUSE': {
      const session = await getActiveSession();
      if (!session) return { ok: false, error: 'no-session' };
      session.state = 'paused';
      await setActiveSession(session);
      await broadcastState(session);
      return { ok: true };
    }

    case 'POPUP_RESUME':
    case 'SESSION_RESUME': {
      const session = await getActiveSession();
      if (!session) return { ok: false, error: 'no-session' };
      session.state = 'recording';
      await setActiveSession(session);
      await broadcastState(session);
      return { ok: true };
    }

    case 'POPUP_GET_STATE': {
      const session = await getActiveSession();
      return { ok: true, data: session };
    }

    case 'POPUP_OPEN_REVIEW': {
      const s = await getActiveSession();
      if (!s) return { ok: false, error: 'no-session' };
      const url = chrome.runtime.getURL(`review/review.html#${s.id}`);
      await chrome.tabs.create({ url });
      return { ok: true };
    }

    case 'POPUP_RECOVER_RESUME': {
      // Session is already in chrome.storage.local — just make sure its
      // state is 'recording' and the active tab gets the content script
      // reattached. The content script's reconnectIfActive() handles the
      // rest on next page load.
      const s = await getActiveSession();
      if (!s) return { ok: false, error: 'no-session' };
      s.state = 'recording';
      // Rebind to the current active tab in case the original tab is gone.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) s.tabId = tab.id;
      await setActiveSession(s);
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_START' } satisfies Message);
        } catch {
          // content script will attach on next navigation
        }
      }
      return { ok: true, data: { sessionId: s.id, tabId: s.tabId } };
    }

    case 'POPUP_RECOVER_REVIEW': {
      const s = await getActiveSession();
      if (!s) return { ok: false, error: 'no-session' };
      // Move the recovered session to the archive without extending it
      s.state = 'stopped';
      s.endedAt = s.endedAt ?? Date.now();
      await archiveSession(s);
      await setActiveSession(null);
      const url = chrome.runtime.getURL(`review/review.html#${s.id}`);
      await chrome.tabs.create({ url });
      return { ok: true, data: { sessionId: s.id } };
    }

    case 'POPUP_RECOVER_DISCARD': {
      // Archive first so nothing is irrevocably lost, then clear active slot.
      const s = await getActiveSession();
      if (!s) return { ok: true };
      s.state = 'stopped';
      s.endedAt = s.endedAt ?? Date.now();
      await archiveSession(s);
      await setActiveSession(null);
      return { ok: true, data: { archivedId: s.id } };
    }

    case 'STEP_EVENT': {
      const session = await getActiveSession();
      if (!session || session.state !== 'recording') return { ok: false, error: 'not-recording' };
      if (session.tabId !== tabId) return { ok: false, error: 'wrong-tab' };
      const step = await appendStep(session, msg.step);
      // Auto-snapshot policy
      const opts = await getOptions();
      const auto =
        (step.kind === 'navigate' && opts.autoSnapOnNavigate) ||
        (step.kind === 'click' && opts.autoSnapOnClick) ||
        (step.kind === 'error' && opts.autoSnapOnError);
      if (auto) {
        // small delay for navigation so the form renders
        if (step.kind === 'navigate') await new Promise((r) => setTimeout(r, 400));
        await snapshotAndAttach(session, step.id);
      }
      return { ok: true, data: { stepId: step.id } };
    }

    case 'REQUEST_SNAPSHOT': {
      const session = await getActiveSession();
      if (!session || session.state !== 'recording') return { ok: false, error: 'not-recording' };
      // Manual snap also creates a dedicated manual-snap step
      let stepId = msg.attachToStepId;
      if (!stepId && msg.reason === 'manual') {
        const step = await appendStep(session, { kind: 'manual-snap', screenshotId: '' } as Omit<Step, 'id' | 'ts'>);
        stepId = step.id;
      }
      const snapId = await snapshotAndAttach(session, stepId);
      return snapId ? { ok: true, data: { snapshotId: snapId } } : { ok: false, error: 'capture-failed' };
    }

    case 'ERROR_DETECTED': {
      const session = await getActiveSession();
      if (!session || session.state !== 'recording') return { ok: false, error: 'not-recording' };
      const step = await appendStep(session, {
        kind: 'error',
        message: msg.message,
        formTitle: msg.formTitle,
      } as Omit<Step, 'id' | 'ts'>);
      const opts = await getOptions();
      if (opts.autoSnapOnError) await snapshotAndAttach(session, step.id);
      return { ok: true };
    }

    case 'REVIEW_GET_SESSION': {
      const active = await getActiveSession();
      if (active && active.id === msg.sessionId) return { ok: true, data: active };
      const arch = await getArchivedSession(msg.sessionId);
      return arch ? { ok: true, data: arch } : { ok: false, error: 'not-found' };
    }

    case 'REVIEW_UPDATE_SESSION': {
      await archiveSession(msg.session);
      return { ok: true };
    }

    case 'REVIEW_GET_SNAPSHOT': {
      const snap = await getSnapshot(msg.snapshotId);
      if (!snap) return { ok: false, error: 'not-found' };
      const dataUrl = await blobToDataUrl(snap.data);
      return { ok: true, data: { dataUrl, ts: snap.ts } };
    }

    case 'REVIEW_ADD_PASTED_IMAGE': {
      const active = await getActiveSession();
      const target = active && active.id === msg.sessionId ? active : await getArchivedSession(msg.sessionId);
      if (!target) return { ok: false, error: 'session-not-found' };
      const blob = await (await fetch(msg.pngDataUrl)).blob();
      const snap: SnapshotBlob = {
        id: uid('img'),
        sessionId: target.id,
        ts: Date.now(),
        mime: 'image/png',
        data: blob,
      };
      await putSnapshot(snap);
      const step: Step = {
        kind: 'pasted-img',
        id: uid('st'),
        ts: Date.now(),
        screenshotId: snap.id,
        note: msg.note,
      };
      target.steps.push(step);
      if (active && active.id === target.id) {
        await setActiveSession(target);
      } else {
        await archiveSession(target);
      }
      return { ok: true, data: { snapshotId: snap.id, stepId: step.id } };
    }

    case 'REVIEW_REPLACE_SNAPSHOT': {
      // Used by the PII redactor: overwrite the existing blob under the same
      // snapshot id so every downstream reference (XML export, tracker
      // submission, IndexedDB) automatically picks up the redacted version.
      const existing = await getSnapshot(msg.snapshotId);
      if (!existing) return { ok: false, error: 'snapshot-not-found' };
      const blob = await (await fetch(msg.pngDataUrl)).blob();
      await putSnapshot({ ...existing, data: blob, ts: Date.now() });
      // Flag the step as redacted so the review page can render a marker
      const active = await getActiveSession();
      const target = active && active.id === msg.sessionId ? active : await getArchivedSession(msg.sessionId);
      if (target) {
        for (const step of target.steps) {
          if ('screenshotId' in step && step.screenshotId === msg.snapshotId) {
            const current = (step as { note?: string }).note ?? '';
            if (!current.includes('[redacted]')) {
              (step as { note?: string }).note = current ? `${current} [redacted]` : '[redacted]';
            }
          }
        }
        if (active && active.id === target.id) await setActiveSession(target);
        else await archiveSession(target);
      }
      return { ok: true };
    }

    case 'REVIEW_EXPORT_XML': {
      const session = await getArchivedSession(msg.sessionId);
      if (!session) return { ok: false, error: 'not-found' };
      try {
        const { url, filename } = await exportSessionAsZip(session);
        await chrome.downloads.download({ url, filename, saveAs: true });
        return { ok: true, data: { filename } };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }

    case 'REVIEW_SUBMIT_TRACKER': {
      const session = await getArchivedSession(msg.sessionId);
      if (!session) return { ok: false, error: 'not-found' };
      try {
        const settings = await getTrackerSettings();
        if (!settings.activeProviderId) throw new Error('No tracker selected. Open Settings and pick one.');
        const provider = getProvider(settings.activeProviderId);
        if (!provider) throw new Error(`Unknown tracker provider: ${settings.activeProviderId}`);
        const config = settings.providerConfigs[provider.id] ?? {};
        const validation = provider.validateConfig(config as Record<string, unknown>);
        if (!validation.ok) throw new Error(`Invalid ${provider.displayName} config: ${Object.values(validation.errors ?? {}).join('; ')}`);
        const { attachments } = await collectAttachments(session);
        const result = await provider.submit(session, config as Record<string, unknown>, attachments);
        return { ok: true, data: { providerId: provider.id, providerName: provider.displayName, ...result } };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }

    case 'REVIEW_GET_TRACKER_INFO': {
      const settings = await getTrackerSettings();
      const active = settings.activeProviderId ? getProvider(settings.activeProviderId) : undefined;
      return {
        ok: true,
        data: {
          activeProviderId: settings.activeProviderId,
          activeProviderName: active?.displayName ?? null,
          providers: TRACKER_PROVIDERS.map((p) => ({ id: p.id, displayName: p.displayName })),
        },
      };
    }

    default:
      return { ok: false, error: `unknown-msg:${(msg as { type?: string }).type ?? '?'}` };
  }
});

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

// ----------------- keyboard commands -----------------

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const session = await getActiveSession();
  switch (command) {
    case 'toggle-recording': {
      if (session && session.state !== 'stopped') {
        // stop
        session.state = 'stopped';
        session.endedAt = Date.now();
        await archiveSession(session);
        await setActiveSession(null);
        await chrome.tabs.create({ url: chrome.runtime.getURL(`review/review.html#${session.id}`) });
      } else {
        // ask content script to start
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_START' } satisfies Message);
        } catch (e) {
          console.warn('[repro] start failed', e);
        }
      }
      break;
    }
    case 'take-snapshot': {
      if (!session || session.state !== 'recording') return;
      await snapshotAndAttach(session);
      break;
    }
    case 'add-note': {
      if (!session || session.state !== 'recording') return;
      // The overlay owns the note modal. Ask the content script to open it;
      // fail silently if the tab doesn't have a content script (the user
      // pressed the shortcut from a non-D365FO tab while a session is live).
      await chrome.tabs
        .sendMessage(tab.id, { type: 'TRIGGER_OVERLAY_NOTE' } satisfies Message)
        .catch(() => undefined);
      break;
    }
    case 'pause-resume': {
      if (!session) return;
      session.state = session.state === 'paused' ? 'recording' : 'paused';
      await setActiveSession(session);
      await broadcastState(session);
      break;
    }
  }
});
