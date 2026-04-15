import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Message, MessageResponse, Session } from '@shared/types';

// Hoist mocks so they're in place before recorder.ts is imported.
// @shared/messaging is the only I/O surface the recorder uses, so replacing
// it gives us a clean black-box harness.
const m = vi.hoisted(() => ({
  send: vi.fn<(msg: Message) => Promise<MessageResponse>>(),
  emitStep: vi.fn<(step: unknown) => Promise<MessageResponse>>(),
  onMessage: vi.fn<(handler: (msg: Message) => Promise<MessageResponse> | MessageResponse) => void>(),
  sendToTab: vi.fn(),
  uid: (prefix: string) => `${prefix}_test`,
}));

vi.mock('@shared/messaging', () => ({
  send: m.send,
  emitStep: m.emitStep,
  onMessage: m.onMessage,
  sendToTab: m.sendToTab,
  uid: m.uid,
}));

const FAKE_SESSION: Session = {
  id: 'ses_test',
  tabId: 1,
  state: 'recording',
  startedAt: 1_700_000_000_000,
  title: '',
  description: '',
  severity: 'med',
  tags: [],
  environment: {
    url: 'https://usmf.dynamics.com',
    host: 'usmf.dynamics.com',
    userAgent: 'test',
    extensionVersion: '0.1.0',
    capturedAt: 0,
  },
  steps: [],
};

let handler: (msg: Message) => Promise<MessageResponse> | MessageResponse;

function defaultSend(msg: Message): Promise<MessageResponse> {
  switch (msg.type) {
    case 'POPUP_GET_STATE':
      return Promise.resolve({ ok: true, data: null });
    case 'GET_MY_TAB_ID':
      return Promise.resolve({ ok: true, data: 1 });
    case 'SESSION_START':
      return Promise.resolve({ ok: true, data: FAKE_SESSION });
    default:
      return Promise.resolve({ ok: true });
  }
}

// Import the recorder once for the entire file. Each test resets state
// through STATE_UPDATE idle rather than re-importing, so listeners don't
// accumulate on the shared jsdom document.
beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p.replace(/^\//, '')}`,
    },
  };
  m.send.mockImplementation(defaultSend);
  await import('../../src/content/recorder');
  const call = m.onMessage.mock.calls[0];
  if (!call) throw new Error('recorder did not register an onMessage handler');
  handler = call[0];
});

beforeEach(async () => {
  m.send.mockClear();
  m.emitStep.mockClear();
  m.send.mockImplementation(defaultSend);
  document.body.innerHTML = '';
  document.title = 'Fake D365FO Page';
  // Tear down the previous test's recorder state: idle detaches listeners,
  // destroys the overlay, and clears focus tracking.
  await handler({ type: 'STATE_UPDATE', state: 'idle', stepCount: 0 });
  // Belt-and-suspenders: drop any stray overlay host left by the last test.
  document.querySelectorAll('#d365-repro-overlay-host').forEach((n) => n.remove());
  m.send.mockClear();
  m.emitStep.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function startRecording(): Promise<void> {
  await handler({ type: 'POPUP_START' });
  // startRecording emits an initial navigate step — clear so tests only see
  // their own events.
  m.emitStep.mockClear();
}

describe('recorder — click capture', () => {
  beforeEach(async () => {
    await startRecording();
  });

  it('emits a click step with the resolved label and role', () => {
    document.body.innerHTML = '<button aria-label="Post">Post</button>';
    const btn = document.querySelector('button')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).toHaveBeenCalledTimes(1);
    expect(m.emitStep).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', label: 'Post', role: 'button' }),
    );
  });

  it('walks up from a nested span to the outer button', () => {
    document.body.innerHTML = '<button aria-label="New"><span>New</span></button>';
    const span = document.querySelector('span')!;
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', label: 'New' }),
    );
  });

  it('ignores clicks inside the overlay host', () => {
    document.body.innerHTML =
      '<div id="d365-repro-overlay-host"><button>Overlay click</button></div>';
    const btn = document.querySelector('button')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).not.toHaveBeenCalled();
  });

  it('drops clicks when no clickable ancestor is found', () => {
    document.body.innerHTML = '<div><p>plain text</p></div>';
    const p = document.querySelector('p')!;
    p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).not.toHaveBeenCalled();
  });
});

describe('recorder — field edit capture', () => {
  beforeEach(async () => {
    await startRecording();
  });

  it('emits an edit step on blur when the value changed', () => {
    document.body.innerHTML = '<label for="name">Journal name</label><input id="name" />';
    const input = document.getElementById('name') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.value = 'GenJrn';
    input.blur();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(m.emitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'edit',
        fieldLabel: 'Journal name',
        oldValue: '',
        newValue: 'GenJrn',
      }),
    );
  });

  it('does not emit when the value is unchanged', () => {
    document.body.innerHTML = '<input aria-label="Foo" value="hello" />';
    const input = document.querySelector('input')!;
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(m.emitStep).not.toHaveBeenCalled();
  });

  it('selects fire immediately on change', () => {
    document.body.innerHTML =
      '<label for="ccy">Currency</label><select id="ccy"><option>USD</option><option>EUR</option></select>';
    const sel = document.getElementById('ccy') as HTMLSelectElement;
    sel.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    sel.value = 'EUR';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(m.emitStep).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'edit', fieldLabel: 'Currency', newValue: 'EUR' }),
    );
  });
});

describe('recorder — navigate capture', () => {
  beforeEach(async () => {
    await startRecording();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  it('emits a navigate step after the 150ms settle delay', () => {
    // location.href is captured as lastNavigationUrl on recording start; a
    // navigate event with the same URL is deduped, so change it first.
    window.history.pushState(null, '', '/new-page?mi=LedgerJournalTable');
    window.dispatchEvent(new CustomEvent('d365-repro:navigate'));
    expect(m.emitStep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(m.emitStep).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate' }));
  });

  it('deduplicates consecutive events for the same URL', () => {
    window.history.pushState(null, '', '/dedupe?x=1');
    window.dispatchEvent(new CustomEvent('d365-repro:navigate'));
    vi.advanceTimersByTime(200);
    m.emitStep.mockClear();
    window.dispatchEvent(new CustomEvent('d365-repro:navigate'));
    vi.advanceTimersByTime(200);
    expect(m.emitStep).not.toHaveBeenCalled();
  });
});

describe('recorder — PING and state transitions', () => {
  it('PING is a no-op: no listeners attach, no overlay mount', async () => {
    await handler({ type: 'PING' });
    document.body.innerHTML = '<button aria-label="X">X</button>';
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).not.toHaveBeenCalled();
    expect(document.getElementById('d365-repro-overlay-host')).toBeNull();
  });

  it('STATE_UPDATE paused stops event capture, recording resumes it', async () => {
    await startRecording();
    document.body.innerHTML = '<button aria-label="A">A</button>';
    const btn = document.querySelector('button')!;

    await handler({ type: 'STATE_UPDATE', state: 'paused', stepCount: 0 });
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).not.toHaveBeenCalled();

    await handler({ type: 'STATE_UPDATE', state: 'recording', stepCount: 0 });
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.emitStep).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', label: 'A' }),
    );
  });

  it('STATE_UPDATE idle removes the overlay', async () => {
    await startRecording();
    expect(document.getElementById('d365-repro-overlay-host')).not.toBeNull();
    await handler({ type: 'STATE_UPDATE', state: 'idle', stepCount: 0 });
    expect(document.getElementById('d365-repro-overlay-host')).toBeNull();
  });
});
