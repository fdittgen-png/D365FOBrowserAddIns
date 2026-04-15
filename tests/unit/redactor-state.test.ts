// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  initialRedactorState,
  redactorReducer,
  currentRects,
  canUndo,
  canRedo,
  normalizeDragRect,
  clientToCanvas,
  type Rect,
  type RedactorState,
} from '../../src/review/redactor-state';

describe('redactorReducer — push', () => {
  it('appends a rect to an empty state and advances the history index', () => {
    const r: Rect = { x: 10, y: 20, w: 30, h: 40 };
    const next = redactorReducer(initialRedactorState, { type: 'push', rect: r });
    expect(currentRects(next)).toEqual([r]);
    expect(next.historyIndex).toBe(1);
    expect(next.history).toHaveLength(2);
  });

  it('pushing N rects produces N+1 history entries (including empty)', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 20, w: 10, h: 10 },
      { x: 40, y: 40, w: 10, h: 10 },
    ];
    let s: RedactorState = initialRedactorState;
    for (const r of rects) s = redactorReducer(s, { type: 'push', rect: r });
    expect(s.history).toHaveLength(4);
    expect(currentRects(s)).toEqual(rects);
  });
});

describe('redactorReducer — undo / redo', () => {
  it('undo reduces the historyIndex', () => {
    let s: RedactorState = initialRedactorState;
    s = redactorReducer(s, { type: 'push', rect: { x: 1, y: 1, w: 1, h: 1 } });
    expect(canUndo(s)).toBe(true);
    s = redactorReducer(s, { type: 'undo' });
    expect(s.historyIndex).toBe(0);
    expect(currentRects(s)).toEqual([]);
  });

  it('undo at the head is a no-op', () => {
    const s = redactorReducer(initialRedactorState, { type: 'undo' });
    expect(s).toEqual(initialRedactorState);
  });

  it('redo is available after an undo', () => {
    let s: RedactorState = initialRedactorState;
    s = redactorReducer(s, { type: 'push', rect: { x: 1, y: 1, w: 1, h: 1 } });
    s = redactorReducer(s, { type: 'undo' });
    expect(canRedo(s)).toBe(true);
    s = redactorReducer(s, { type: 'redo' });
    expect(currentRects(s)).toEqual([{ x: 1, y: 1, w: 1, h: 1 }]);
  });

  it('pushing after an undo truncates the redo stack', () => {
    let s: RedactorState = initialRedactorState;
    s = redactorReducer(s, { type: 'push', rect: { x: 1, y: 1, w: 1, h: 1 } });
    s = redactorReducer(s, { type: 'push', rect: { x: 2, y: 2, w: 2, h: 2 } });
    s = redactorReducer(s, { type: 'undo' });
    expect(canRedo(s)).toBe(true);
    s = redactorReducer(s, { type: 'push', rect: { x: 9, y: 9, w: 9, h: 9 } });
    expect(canRedo(s)).toBe(false);
    expect(currentRects(s)).toEqual([
      { x: 1, y: 1, w: 1, h: 1 },
      { x: 9, y: 9, w: 9, h: 9 },
    ]);
  });
});

describe('redactorReducer — clear', () => {
  it('clear on an empty state is a no-op', () => {
    const s = redactorReducer(initialRedactorState, { type: 'clear' });
    expect(s).toEqual(initialRedactorState);
  });

  it('clear after pushes produces a new empty entry', () => {
    let s: RedactorState = initialRedactorState;
    s = redactorReducer(s, { type: 'push', rect: { x: 1, y: 1, w: 1, h: 1 } });
    s = redactorReducer(s, { type: 'clear' });
    expect(currentRects(s)).toEqual([]);
    expect(canUndo(s)).toBe(true);
    expect(canRedo(s)).toBe(false);
  });
});

describe('normalizeDragRect', () => {
  it('returns a positive-width rect regardless of drag direction', () => {
    const r1 = normalizeDragRect({ x: 10, y: 10 }, { x: 50, y: 60 });
    const r2 = normalizeDragRect({ x: 50, y: 60 }, { x: 10, y: 10 });
    expect(r1).toEqual({ x: 10, y: 10, w: 40, h: 50 });
    expect(r2).toEqual({ x: 10, y: 10, w: 40, h: 50 });
  });

  it('returns null for rects smaller than the minSize', () => {
    expect(normalizeDragRect({ x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(normalizeDragRect({ x: 0, y: 0 }, { x: 2, y: 50 })).toBeNull();
  });

  it('respects a custom minSize', () => {
    expect(normalizeDragRect({ x: 0, y: 0 }, { x: 5, y: 5 }, 10)).toBeNull();
    expect(normalizeDragRect({ x: 0, y: 0 }, { x: 12, y: 12 }, 10)).not.toBeNull();
  });
});

describe('clientToCanvas', () => {
  it('scales client coordinates by canvas-to-css ratio', () => {
    const canvas = {
      width: 1000,
      height: 800,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect),
    };
    const p = clientToCanvas({ clientX: 250, clientY: 200 }, canvas);
    expect(p).toEqual({ x: 500, y: 400 });
  });

  it('subtracts the bounding rect left/top offset', () => {
    const canvas = {
      width: 100,
      height: 100,
      getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 100 } as DOMRect),
    };
    const p = clientToCanvas({ clientX: 50, clientY: 60 }, canvas);
    expect(p).toEqual({ x: 20, y: 20 });
  });
});
