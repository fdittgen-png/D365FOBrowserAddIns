/**
 * Floating recorder widget rendered inside a Shadow DOM so the host page's CSS
 * can't leak in. Minimal, draggable, reflects the current session state.
 */

export interface OverlayCallbacks {
  onSnapshot(): void;
  onAddNote(text: string): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

export interface OverlayHandle {
  setState(state: 'recording' | 'paused' | 'idle', stepCount: number): void;
  destroy(): void;
  promptNote(): void;
}

const CSS = `
  :host {
    all: initial;
    position: fixed;
    z-index: 2147483646;
    top: 80px;
    right: 24px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #111827;
  }
  .wrap {
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    width: 220px;
    user-select: none;
    overflow: hidden;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px;
    background: #f9fafb; border-bottom: 1px solid #e5e7eb;
    cursor: grab;
    font-size: 12px; font-weight: 600;
  }
  .header.recording { background:#fee2e2; color:#991b1b; }
  .header.paused    { background:#fef3c7; color:#92400e; }
  .dot { width:10px; height:10px; border-radius:50%; background:#9ca3af; display:inline-block; margin-right:6px; }
  .dot.recording { background:#dc2626; animation: pulse 1.3s infinite; }
  .dot.paused    { background:#f59e0b; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity: .35; } }
  .body { padding: 8px 10px; display:flex; flex-direction:column; gap:6px; font-size:12px; }
  .row { display:flex; gap:6px; }
  button {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    font: inherit;
    cursor: pointer;
    font-size: 11px;
  }
  button:hover { background:#f3f4f6; }
  button.primary { background:#2563eb; color:white; border-color:#2563eb; }
  button.danger  { background:#dc2626; color:white; border-color:#dc2626; }
  .count { color:#6b7280; font-size: 11px; }
  .note-modal {
    position: absolute; top: 46px; left: 10px; right: 10px;
    background: white; border: 1px solid #d1d5db; border-radius: 6px;
    padding: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    display: none; flex-direction: column; gap:6px;
  }
  .note-modal.open { display: flex; }
  textarea { width:100%; min-height: 60px; box-sizing:border-box; resize: vertical;
             border:1px solid #d1d5db; border-radius:4px; padding:4px; font: inherit; font-size: 12px; }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
  textarea:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
`;

export function mountOverlay(cb: OverlayCallbacks): OverlayHandle {
  const host = document.createElement('div');
  host.id = 'd365-repro-overlay-host';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="wrap" role="region" aria-label="D365FO Repro Recorder controls">
      <div class="header" id="header" role="toolbar" aria-label="Recorder header, drag to move">
        <span><span class="dot" id="dot" aria-hidden="true"></span><span id="label">Idle</span></span>
        <span class="count" id="count" aria-live="polite">0 steps</span>
      </div>
      <div class="body">
        <div class="row">
          <button id="btn-snap" type="button" aria-label="Take a screenshot now">📸 Snap</button>
          <button id="btn-note" type="button" aria-label="Add a note to the session">📝 Note</button>
        </div>
        <div class="row">
          <button id="btn-pause" type="button" aria-label="Pause recording">Pause</button>
          <button id="btn-stop" class="danger" type="button" aria-label="Stop recording and open the review page">Stop</button>
        </div>
      </div>
      <div class="note-modal" id="note-modal" role="dialog" aria-modal="true" aria-label="Add a session note">
        <label class="sr-only" for="note-text">Note text</label>
        <textarea id="note-text" placeholder="Describe what just happened..."></textarea>
        <div class="row">
          <button id="note-cancel" type="button">Cancel</button>
          <button id="note-save" class="primary" type="button">Save note</button>
        </div>
      </div>
      <span class="sr-only" id="live-status" aria-live="polite"></span>
    </div>
  `;

  document.documentElement.appendChild(host);

  const header = root.getElementById('header') as HTMLElement;
  const dot = root.getElementById('dot') as HTMLElement;
  const label = root.getElementById('label') as HTMLElement;
  const count = root.getElementById('count') as HTMLElement;
  const btnSnap = root.getElementById('btn-snap') as HTMLButtonElement;
  const btnNote = root.getElementById('btn-note') as HTMLButtonElement;
  const btnPause = root.getElementById('btn-pause') as HTMLButtonElement;
  const btnStop = root.getElementById('btn-stop') as HTMLButtonElement;
  const noteModal = root.getElementById('note-modal') as HTMLElement;
  const noteText = root.getElementById('note-text') as HTMLTextAreaElement;
  const noteCancel = root.getElementById('note-cancel') as HTMLButtonElement;
  const noteSave = root.getElementById('note-save') as HTMLButtonElement;
  const liveStatus = root.getElementById('live-status') as HTMLElement;

  let lastFocusedBeforeModal: HTMLElement | null = null;
  function openNoteModal(): void {
    lastFocusedBeforeModal = (document.activeElement as HTMLElement) ?? null;
    noteModal.classList.add('open');
    noteText.focus();
  }
  function closeNoteModal(): void {
    noteModal.classList.remove('open');
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
  }
  // Focus trap inside the note modal
  noteModal.addEventListener('keydown', (ev) => {
    if (!noteModal.classList.contains('open')) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeNoteModal();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focusable = [noteText, noteCancel, noteSave];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });

  btnSnap.addEventListener('click', () => cb.onSnapshot());
  btnNote.addEventListener('click', () => handle.promptNote());
  btnPause.addEventListener('click', () => {
    if (btnPause.textContent === 'Pause') cb.onPause();
    else cb.onResume();
  });
  btnStop.addEventListener('click', () => cb.onStop());

  noteCancel.addEventListener('click', () => closeNoteModal());
  noteSave.addEventListener('click', () => {
    const t = noteText.value.trim();
    if (t) cb.onAddNote(t);
    noteText.value = '';
    closeNoteModal();
  });

  // --- drag handling (persist position in session storage) ---
  let dragging = false;
  let offX = 0, offY = 0;
  header.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = host.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    host.style.transition = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    host.style.left = `${e.clientX - offX}px`;
    host.style.top = `${e.clientY - offY}px`;
    host.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  const handle: OverlayHandle = {
    setState(state, stepCount) {
      header.classList.remove('recording', 'paused');
      dot.classList.remove('recording', 'paused');
      if (state === 'recording') {
        header.classList.add('recording');
        dot.classList.add('recording');
        label.textContent = 'Recording';
        btnPause.textContent = 'Pause';
        btnPause.setAttribute('aria-label', 'Pause recording');
      } else if (state === 'paused') {
        header.classList.add('paused');
        dot.classList.add('paused');
        label.textContent = 'Paused';
        btnPause.textContent = 'Resume';
        btnPause.setAttribute('aria-label', 'Resume recording');
      } else {
        label.textContent = 'Idle';
      }
      count.textContent = `${stepCount} step${stepCount === 1 ? '' : 's'}`;
      // Announce state changes to assistive tech
      liveStatus.textContent = `Recorder ${label.textContent}, ${count.textContent}`;
    },
    destroy() {
      host.remove();
    },
    promptNote() {
      openNoteModal();
    },
  };
  return handle;
}
