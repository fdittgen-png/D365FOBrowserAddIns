import { send } from '@shared/messaging';
import type { Session } from '@shared/types';
import { applyI18n, t } from '@shared/i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function humanAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

async function refresh(): Promise<void> {
  const resp = await send<Session | null>({ type: 'POPUP_GET_STATE' });
  const session = resp.ok ? resp.data : null;

  // Recovery banner — surface when an active session exists but it was
  // paused or never cleanly stopped before we opened the popup. We use a
  // simple heuristic: if the session has been active for more than 30s
  // without activity in this popup window, treat it as potentially
  // orphaned from a previous browser run. A cleaner signal would require
  // tracking serviceWorker lifetime explicitly.
  const banner = $<HTMLElement>('recover-banner');
  const sub = $<HTMLElement>('recover-sub');
  if (session && (session.state === 'recording' || session.state === 'paused')) {
    // Check whether the session's tab is still open.
    let tabStillOpen = false;
    try {
      await chrome.tabs.get(session.tabId);
      tabStillOpen = true;
    } catch {
      tabStillOpen = false;
    }
    if (!tabStillOpen) {
      banner.hidden = false;
      sub.textContent = `${session.steps.length} steps from ${humanAgo(session.startedAt)}, original tab is gone`;
    } else {
      banner.hidden = true;
    }
  } else {
    banner.hidden = true;
  }

  const badge = $<HTMLSpanElement>('state-badge');
  const sid = $<HTMLSpanElement>('session-id');
  const stepCount = $<HTMLSpanElement>('step-count');
  const tabInfo = $<HTMLSpanElement>('tab-info');

  const btnStart = $<HTMLButtonElement>('btn-start');
  const btnStop = $<HTMLButtonElement>('btn-stop');
  const btnPause = $<HTMLButtonElement>('btn-pause');
  const btnResume = $<HTMLButtonElement>('btn-resume');
  const btnReview = $<HTMLButtonElement>('btn-review');

  if (session && (session.state === 'recording' || session.state === 'paused')) {
    badge.className = `badge ${session.state}`;
    badge.textContent = session.state === 'recording' ? t('stateRecording') : t('statePaused');
    sid.textContent = session.id.slice(-8);
    stepCount.textContent = String(session.steps.length);
    tabInfo.textContent = session.environment.company ?? session.environment.host;
    btnStart.hidden = true;
    btnStop.hidden = false;
    btnPause.hidden = session.state !== 'recording';
    btnResume.hidden = session.state !== 'paused';
    btnReview.hidden = false;
  } else {
    badge.className = 'badge idle';
    badge.textContent = t('stateIdle');
    sid.textContent = '—';
    stepCount.textContent = '0';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabInfo.textContent = tab?.url ? new URL(tab.url).host : '—';
    btnStart.hidden = false;
    btnStop.hidden = true;
    btnPause.hidden = true;
    btnResume.hidden = true;
    btnReview.hidden = true;
  }
}

function toast(msg: string): void {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;background:#111827;color:white;padding:6px 10px;border-radius:6px;font-size:12px;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  void refresh();

  $<HTMLButtonElement>('btn-start').addEventListener('click', async () => {
    const resp = await send({ type: 'POPUP_START' });
    if (!resp.ok) toast(`Start failed: ${resp.error}`);
    setTimeout(refresh, 200);
  });
  $<HTMLButtonElement>('btn-stop').addEventListener('click', async () => {
    const resp = await send({ type: 'POPUP_STOP' });
    if (!resp.ok) toast(`Stop failed: ${resp.error}`);
    setTimeout(refresh, 200);
  });
  $<HTMLButtonElement>('btn-pause').addEventListener('click', async () => {
    await send({ type: 'POPUP_PAUSE' });
    setTimeout(refresh, 100);
  });
  $<HTMLButtonElement>('btn-resume').addEventListener('click', async () => {
    await send({ type: 'POPUP_RESUME' });
    setTimeout(refresh, 100);
  });
  $<HTMLButtonElement>('btn-review').addEventListener('click', async () => {
    await send({ type: 'POPUP_OPEN_REVIEW' });
  });
  $<HTMLAnchorElement>('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $<HTMLButtonElement>('btn-recover-resume').addEventListener('click', async () => {
    const r = await send({ type: 'POPUP_RECOVER_RESUME' });
    if (!r.ok) toast(`Resume failed: ${r.error}`);
    setTimeout(refresh, 150);
  });
  $<HTMLButtonElement>('btn-recover-review').addEventListener('click', async () => {
    const r = await send({ type: 'POPUP_RECOVER_REVIEW' });
    if (!r.ok) toast(`Review failed: ${r.error}`);
    setTimeout(refresh, 150);
  });
  $<HTMLButtonElement>('btn-recover-discard').addEventListener('click', async () => {
    if (!confirm('Discard the unsaved recording? The archived copy will remain available in chrome.storage until you run a new recording.')) return;
    const r = await send({ type: 'POPUP_RECOVER_DISCARD' });
    if (!r.ok) toast(`Discard failed: ${r.error}`);
    setTimeout(refresh, 150);
  });
});
