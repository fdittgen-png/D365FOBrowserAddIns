/**
 * In-browser redaction editor. Opens in a modal, lets the user drag black
 * rectangles over a screenshot to hide PII, and resolves with the edited
 * PNG as a data URL.
 *
 * Keeps the entire interaction inside the extension — no external services,
 * no copying of the image out of IndexedDB.
 */

export interface RedactorOptions {
  sourceDataUrl: string;
  onSave: (editedDataUrl: string) => void;
  onCancel?: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function openRedactor(opts: RedactorOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'redactor-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Redact screenshot');

  overlay.innerHTML = `
    <style>
      .redactor-overlay { position:fixed; inset:0; background:rgba(17,24,39,0.75); z-index:20000;
        display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; }
      .redactor-wrap { background:white; border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,0.4);
        max-width: 95vw; max-height: 95vh; display:flex; flex-direction:column; }
      .redactor-toolbar { display:flex; gap:8px; padding:10px 14px; border-bottom:1px solid #e5e7eb;
        align-items:center; font-family: system-ui, sans-serif; }
      .redactor-toolbar button { padding:6px 12px; border:1px solid #d1d5db; border-radius:6px;
        background:white; cursor:pointer; font:inherit; font-size:13px; }
      .redactor-toolbar button:hover { background:#f3f4f6; }
      .redactor-toolbar button.primary { background:#2563eb; color:white; border-color:#2563eb; }
      .redactor-toolbar button.danger { background:#dc2626; color:white; border-color:#dc2626; }
      .redactor-toolbar button:disabled { opacity:0.5; cursor:not-allowed; }
      .redactor-hint { flex:1; font-size:12px; color:#6b7280; }
      .redactor-canvas-wrap { position:relative; overflow:auto; max-height: 75vh; }
      .redactor-canvas { display:block; cursor: crosshair; }
    </style>
    <div class="redactor-wrap">
      <div class="redactor-toolbar">
        <button type="button" id="red-undo" disabled>Undo</button>
        <button type="button" id="red-redo" disabled>Redo</button>
        <button type="button" id="red-clear">Clear all</button>
        <span class="redactor-hint">Drag to draw a black rectangle over anything that should be hidden.</span>
        <button type="button" id="red-cancel">Cancel</button>
        <button type="button" id="red-save" class="primary">Save redacted image</button>
      </div>
      <div class="redactor-canvas-wrap">
        <canvas class="redactor-canvas" id="red-canvas"></canvas>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const canvas = overlay.querySelector<HTMLCanvasElement>('#red-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const undoBtn = overlay.querySelector<HTMLButtonElement>('#red-undo')!;
  const redoBtn = overlay.querySelector<HTMLButtonElement>('#red-redo')!;
  const clearBtn = overlay.querySelector<HTMLButtonElement>('#red-clear')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#red-cancel')!;
  const saveBtn = overlay.querySelector<HTMLButtonElement>('#red-save')!;

  const history: Rect[][] = [[]];
  let historyIndex = 0;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    redraw();
  };
  img.src = opts.sourceDataUrl;

  function currentRects(): Rect[] {
    return history[historyIndex]!;
  }

  function redraw(dragRect?: Rect): void {
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = '#000';
    for (const r of currentRects()) ctx.fillRect(r.x, r.y, r.w, r.h);
    if (dragRect) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
      ctx.restore();
    }
  }

  function pushHistory(rects: Rect[]): void {
    history.splice(historyIndex + 1);
    history.push(rects);
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons(): void {
    undoBtn.disabled = historyIndex === 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
  }

  undoBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
      historyIndex--;
      redraw();
      updateHistoryButtons();
    }
  });
  redoBtn.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      redraw();
      updateHistoryButtons();
    }
  });
  clearBtn.addEventListener('click', () => {
    if (currentRects().length === 0) return;
    pushHistory([]);
    redraw();
  });

  let drawing = false;
  let start: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    start = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!drawing || !start) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    redraw({ x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) });
  });
  canvas.addEventListener('mouseup', (e) => {
    if (!drawing || !start) return;
    drawing = false;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    const newRect: Rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    start = null;
    if (newRect.w < 3 || newRect.h < 3) { redraw(); return; }
    pushHistory([...currentRects(), newRect]);
    redraw();
  });

  function close(): void {
    overlay.remove();
  }

  cancelBtn.addEventListener('click', () => {
    close();
    opts.onCancel?.();
  });
  saveBtn.addEventListener('click', () => {
    redraw();
    const dataUrl = canvas.toDataURL('image/png');
    close();
    opts.onSave(dataUrl);
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      opts.onCancel?.();
    }
  });
  overlay.tabIndex = -1;
  overlay.focus();
}
