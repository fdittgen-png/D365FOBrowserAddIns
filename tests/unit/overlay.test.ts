import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountOverlayForTest } from '../../src/content/overlay';

function freshCallbacks() {
  return {
    onSnapshot: vi.fn(),
    onAddNote: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
  };
}

function mount() {
  const cb = freshCallbacks();
  const { handle, host } = mountOverlayForTest(cb);
  const shadow = host.shadowRoot!;
  return { cb, handle, host, shadow };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.querySelectorAll('#d365-repro-overlay-host').forEach((n) => n.remove());
});

afterEach(() => {
  document.documentElement.querySelectorAll('#d365-repro-overlay-host').forEach((n) => n.remove());
});

describe('overlay — mounting', () => {
  it('attaches the host to document.documentElement with a known id', () => {
    mount();
    expect(document.getElementById('d365-repro-overlay-host')).not.toBeNull();
  });

  it('exposes an open shadow root for tests', () => {
    const { shadow } = mount();
    expect(shadow).toBeInstanceOf(ShadowRoot);
  });

  it('mounts with no initial state — label reads "Idle"', () => {
    const { shadow } = mount();
    expect(shadow.getElementById('label')?.textContent).toBe('Idle');
  });

  it('destroy() removes the host element', () => {
    const { handle } = mount();
    handle.destroy();
    expect(document.getElementById('d365-repro-overlay-host')).toBeNull();
  });
});

describe('overlay — state rendering', () => {
  it('setState("recording", 3) flips header to recording and shows 3 steps', () => {
    const { shadow, handle } = mount();
    handle.setState('recording', 3);
    const header = shadow.getElementById('header')!;
    expect(header.classList.contains('recording')).toBe(true);
    expect(shadow.getElementById('label')?.textContent).toBe('Recording');
    expect(shadow.getElementById('count')?.textContent).toBe('3 steps');
  });

  it('setState("paused", 1) shows Paused and "1 step" (singular)', () => {
    const { shadow, handle } = mount();
    handle.setState('paused', 1);
    expect(shadow.getElementById('label')?.textContent).toBe('Paused');
    expect(shadow.getElementById('count')?.textContent).toBe('1 step');
    const btn = shadow.getElementById('btn-pause') as HTMLButtonElement;
    expect(btn.textContent).toBe('Resume');
    expect(btn.getAttribute('aria-label')).toBe('Resume recording');
  });

  it('live-status announces via aria-live', () => {
    const { shadow, handle } = mount();
    handle.setState('recording', 5);
    const live = shadow.getElementById('live-status');
    expect(live?.textContent).toContain('Recording');
    expect(live?.textContent).toContain('5 steps');
  });
});

describe('overlay — callbacks', () => {
  it('Snap button invokes onSnapshot', () => {
    const { shadow, cb } = mount();
    (shadow.getElementById('btn-snap') as HTMLButtonElement).click();
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('Stop button invokes onStop', () => {
    const { shadow, cb } = mount();
    (shadow.getElementById('btn-stop') as HTMLButtonElement).click();
    expect(cb.onStop).toHaveBeenCalledTimes(1);
  });

  it('Pause button toggles between onPause and onResume based on current state', () => {
    const { shadow, handle, cb } = mount();
    (shadow.getElementById('btn-pause') as HTMLButtonElement).click();
    expect(cb.onPause).toHaveBeenCalledTimes(1);
    expect(cb.onResume).not.toHaveBeenCalled();

    handle.setState('paused', 0);
    (shadow.getElementById('btn-pause') as HTMLButtonElement).click();
    expect(cb.onResume).toHaveBeenCalledTimes(1);
  });
});

describe('overlay — note modal', () => {
  it('Note button opens the modal', () => {
    const { shadow, handle } = mount();
    handle.promptNote();
    const modal = shadow.getElementById('note-modal');
    expect(modal?.classList.contains('open')).toBe(true);
  });

  it('Save with non-empty text calls onAddNote then closes', () => {
    const { shadow, handle, cb } = mount();
    handle.promptNote();
    const textarea = shadow.getElementById('note-text') as HTMLTextAreaElement;
    textarea.value = 'something happened';
    (shadow.getElementById('note-save') as HTMLButtonElement).click();
    expect(cb.onAddNote).toHaveBeenCalledWith('something happened');
    expect(shadow.getElementById('note-modal')?.classList.contains('open')).toBe(false);
  });

  it('Save with empty text does NOT call onAddNote but still closes', () => {
    const { shadow, handle, cb } = mount();
    handle.promptNote();
    (shadow.getElementById('note-save') as HTMLButtonElement).click();
    expect(cb.onAddNote).not.toHaveBeenCalled();
    expect(shadow.getElementById('note-modal')?.classList.contains('open')).toBe(false);
  });

  it('Cancel closes without emitting a note', () => {
    const { shadow, handle, cb } = mount();
    handle.promptNote();
    (shadow.getElementById('note-cancel') as HTMLButtonElement).click();
    expect(cb.onAddNote).not.toHaveBeenCalled();
    expect(shadow.getElementById('note-modal')?.classList.contains('open')).toBe(false);
  });
});

describe('overlay — accessibility', () => {
  it('every action button has a non-empty aria-label', () => {
    const { shadow } = mount();
    const buttons = ['btn-snap', 'btn-note', 'btn-pause', 'btn-stop'];
    for (const id of buttons) {
      const el = shadow.getElementById(id);
      expect(el?.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('recording dot is aria-hidden (decorative)', () => {
    const { shadow } = mount();
    expect(shadow.getElementById('dot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('step counter has aria-live polite', () => {
    const { shadow } = mount();
    expect(shadow.getElementById('count')?.getAttribute('aria-live')).toBe('polite');
  });

  it('note modal has role=dialog and aria-modal=true', () => {
    const { shadow } = mount();
    const modal = shadow.getElementById('note-modal')!;
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });
});
