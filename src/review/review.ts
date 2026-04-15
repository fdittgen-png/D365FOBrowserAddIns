import { send } from '@shared/messaging';
import type { Message, Session, Step } from '@shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const snapCache = new Map<string, string>();

let session: Session | null = null;
let dirty = false;
let saveTimer: number | null = null;

async function loadSession(): Promise<void> {
  const id = location.hash.slice(1);
  if (!id) { toast('No session id in URL'); return; }
  const resp = await send<Session>({ type: 'REVIEW_GET_SESSION', sessionId: id });
  if (!resp.ok || !resp.data) { toast(`Session not found: ${resp.error}`); return; }
  session = resp.data;
  renderEnvironment();
  renderMeta();
  await renderSteps();
}

function renderEnvironment(): void {
  if (!session) return;
  const env = session.environment;
  const dl = $<HTMLDListElement>('env-list');
  dl.innerHTML = '';
  const rows: Array<[string, string | undefined]> = [
    ['Host', env.host],
    ['Tenant', env.tenant],
    ['Company', env.company],
    ['Language', env.language],
    ['Started', new Date(session.startedAt).toLocaleString()],
    ['Ended', session.endedAt ? new Date(session.endedAt).toLocaleString() : '—'],
    ['Duration', session.endedAt ? `${Math.round((session.endedAt - session.startedAt) / 1000)}s` : '—'],
    ['URL', env.url],
    ['User agent', env.userAgent],
    ['Extension', env.extensionVersion],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v ?? '—';
    dl.appendChild(dt); dl.appendChild(dd);
  }
}

function renderMeta(): void {
  if (!session) return;
  $<HTMLInputElement>('title').value = session.title;
  $<HTMLSelectElement>('severity').value = session.severity;
  $<HTMLInputElement>('tags').value = session.tags.join(', ');
  $<HTMLTextAreaElement>('description').value = session.description;
}

async function getSnapshotDataUrl(id: string): Promise<string | null> {
  if (snapCache.has(id)) return snapCache.get(id)!;
  const resp = await send<{ dataUrl: string; ts: number }>({ type: 'REVIEW_GET_SNAPSHOT', snapshotId: id });
  if (!resp.ok || !resp.data) return null;
  snapCache.set(id, resp.data.dataUrl);
  return resp.data.dataUrl;
}

function stepSummary(step: Step): { label: string; sub?: string } {
  switch (step.kind) {
    case 'navigate': return { label: step.formTitle ?? step.menuItem ?? 'Navigate', sub: step.url };
    case 'click':    return { label: step.label, sub: step.role ?? '' };
    case 'edit':     return { label: step.fieldLabel, sub: `"${step.oldValue}" → "${step.newValue}"` };
    case 'error':    return { label: 'Error', sub: step.message };
    case 'manual-snap': return { label: 'Manual snapshot', sub: step.formTitle };
    case 'note':     return { label: 'Note', sub: step.text };
    case 'pasted-img': return { label: 'Pasted image', sub: step.note };
  }
}

async function renderSteps(): Promise<void> {
  if (!session) return;
  const ol = $<HTMLOListElement>('steps-list');
  ol.innerHTML = '';
  for (let i = 0; i < session.steps.length; i++) {
    const step = session.steps[i]!;
    const li = document.createElement('li');
    li.className = 'step';
    const { label, sub } = stepSummary(step);

    const idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = String(i + 1);

    const kind = document.createElement('div');
    kind.className = `kind ${step.kind}`;
    kind.textContent = step.kind;

    const body = document.createElement('div');
    body.className = 'body';
    const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = label;
    body.appendChild(lbl);
    if (sub) { const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub; body.appendChild(s); }
    if (step.kind !== 'note') {
      const note = document.createElement('textarea');
      note.placeholder = 'Add a note to this step...';
      note.value = ('note' in step && step.note) || '';
      note.addEventListener('input', () => {
        (step as { note?: string }).note = note.value;
        markDirty();
      });
      body.appendChild(note);
    }

    const controls = document.createElement('div');
    controls.className = 'controls';
    const up = document.createElement('button'); up.textContent = '↑';
    up.addEventListener('click', () => { moveStep(i, -1); });
    const down = document.createElement('button'); down.textContent = '↓';
    down.addEventListener('click', () => { moveStep(i, 1); });
    const del = document.createElement('button'); del.textContent = '✕';
    del.addEventListener('click', () => {
      if (!confirm('Delete this step?')) return;
      session!.steps.splice(i, 1);
      markDirty();
      void renderSteps();
    });
    controls.append(up, down, del);

    li.append(idx, kind, body, controls);

    if ('screenshotId' in step && step.screenshotId) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.alt = 'screenshot';
      li.appendChild(img);
      void getSnapshotDataUrl(step.screenshotId).then((url) => {
        if (url) img.src = url;
      });
      img.addEventListener('click', () => {
        if (img.src) window.open(img.src, '_blank');
      });
    }

    ol.appendChild(li);
  }
}

function moveStep(i: number, delta: number): void {
  if (!session) return;
  const j = i + delta;
  if (j < 0 || j >= session.steps.length) return;
  const a = session.steps[i]!;
  session.steps[i] = session.steps[j]!;
  session.steps[j] = a;
  markDirty();
  void renderSteps();
}

function markDirty(): void {
  dirty = true;
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 400);
}

async function persist(): Promise<void> {
  if (!session || !dirty) return;
  session.title = $<HTMLInputElement>('title').value;
  session.description = $<HTMLTextAreaElement>('description').value;
  session.severity = $<HTMLSelectElement>('severity').value as Session['severity'];
  session.tags = $<HTMLInputElement>('tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  dirty = false;
  await send({ type: 'REVIEW_UPDATE_SESSION', session });
}

function toast(msg: string): void {
  const t = $<HTMLDivElement>('toast');
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  void loadSession();

  const onMetaChange = () => markDirty();
  $<HTMLInputElement>('title').addEventListener('input', onMetaChange);
  $<HTMLTextAreaElement>('description').addEventListener('input', onMetaChange);
  $<HTMLSelectElement>('severity').addEventListener('change', onMetaChange);
  $<HTMLInputElement>('tags').addEventListener('input', onMetaChange);

  $<HTMLButtonElement>('btn-export-xml').addEventListener('click', async () => {
    if (!session) return;
    await persist();
    const resp = await send<{ filename: string }>({ type: 'REVIEW_EXPORT_XML', sessionId: session.id });
    if (resp.ok) toast(`Exported ${resp.data?.filename}`);
    else toast(`Export failed: ${resp.error}`);
  });

  $<HTMLButtonElement>('btn-submit-tracker').addEventListener('click', async () => {
    if (!session) return;
    await persist();
    const info = await send<{ activeProviderName: string | null }>({ type: 'REVIEW_GET_TRACKER_INFO' });
    const name = info.ok && info.data?.activeProviderName ? info.data.activeProviderName : 'tracker';
    toast(`Submitting to ${name}...`);
    const resp = await send<{ ticketNumber?: string; ticketId?: string; ticketUrl?: string; providerName?: string }>({
      type: 'REVIEW_SUBMIT_TRACKER',
      sessionId: session.id,
    });
    if (resp.ok) {
      const n = resp.data?.ticketNumber ?? resp.data?.ticketId ?? '?';
      toast(`${resp.data?.providerName ?? 'Tracker'} ticket created: ${n}`);
      if (resp.data?.ticketUrl) window.open(resp.data.ticketUrl, '_blank');
    } else {
      toast(`Submit failed: ${resp.error}`);
    }
  });

  // clipboard paste
  document.addEventListener('paste', async (ev) => {
    if (!session) return;
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        const current: Session | null = session;
        if (!current) return;
        const resp = await send<{ snapshotId: string; stepId: string }>({
          type: 'REVIEW_ADD_PASTED_IMAGE',
          sessionId: current.id,
          pngDataUrl: dataUrl,
        });
        if (resp.ok) {
          const sresp: Awaited<ReturnType<typeof send<Session>>> = await send<Session>({ type: 'REVIEW_GET_SESSION', sessionId: current.id });
          if (sresp.ok && sresp.data) {
            session = sresp.data;
            await renderSteps();
            toast('Image pasted as new step');
          }
        } else {
          toast(`Paste failed: ${resp.error}`);
        }
      }
    }
  });

  window.addEventListener('beforeunload', () => { void persist(); });
});

// Keep TS happy about the Message import
export type { Message };
