/**
 * Pure state machine for the redactor's history / drag / normalization
 * logic. Kept separate from the DOM so it can be unit-tested deterministically.
 * The canvas UI layer in `redactor.ts` is a thin wrapper that drives this
 * reducer from mouse events.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactorState {
  /** Timeline of committed rectangle lists, indexed by historyIndex. */
  history: readonly Rect[][];
  historyIndex: number;
}

export type RedactorAction =
  | { type: 'push'; rect: Rect }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

export const initialRedactorState: RedactorState = {
  history: [[]],
  historyIndex: 0,
};

export function currentRects(state: RedactorState): readonly Rect[] {
  return state.history[state.historyIndex] ?? [];
}

export function canUndo(state: RedactorState): boolean {
  return state.historyIndex > 0;
}

export function canRedo(state: RedactorState): boolean {
  return state.historyIndex < state.history.length - 1;
}

/**
 * Reduce a single action. Splicing on a new push when not at the head
 * truncates the redo stack — standard undo history semantics.
 */
export function redactorReducer(state: RedactorState, action: RedactorAction): RedactorState {
  switch (action.type) {
    case 'push': {
      const truncated = state.history.slice(0, state.historyIndex + 1);
      const nextRects = [...currentRects(state), action.rect];
      return {
        history: [...truncated, nextRects],
        historyIndex: truncated.length,
      };
    }
    case 'clear': {
      if (currentRects(state).length === 0) return state;
      const truncated = state.history.slice(0, state.historyIndex + 1);
      return {
        history: [...truncated, []],
        historyIndex: truncated.length,
      };
    }
    case 'undo': {
      if (!canUndo(state)) return state;
      return { ...state, historyIndex: state.historyIndex - 1 };
    }
    case 'redo': {
      if (!canRedo(state)) return state;
      return { ...state, historyIndex: state.historyIndex + 1 };
    }
  }
}

/**
 * Normalize a drag into a rectangle with positive width/height regardless
 * of drag direction. Returns null if the drag is smaller than `minSize`
 * pixels in either dimension — tiny accidental clicks are ignored.
 */
export function normalizeDragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minSize = 3,
): Rect | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < minSize || h < minSize) return null;
  return { x, y, w, h };
}

/**
 * Translate client (mouse event) coordinates into canvas-space coordinates
 * so drawing matches exactly regardless of CSS-induced scaling.
 */
export function clientToCanvas(
  event: { clientX: number; clientY: number },
  canvas: { width: number; height: number; getBoundingClientRect(): DOMRect },
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
}
