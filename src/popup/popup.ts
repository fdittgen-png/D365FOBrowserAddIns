import { send } from '@shared/messaging';
import type { Session } from '@shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function refresh(): Promise<void> {
  const resp = await send<Session | null>({ type: 'POPUP_GET_STATE' });
  const session = resp.ok ? resp.data : null;

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
    badge.textContent = session.state === 'recording' ? 'Recording' : 'Paused';
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
    badge.textContent = 'Idle';
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
});
