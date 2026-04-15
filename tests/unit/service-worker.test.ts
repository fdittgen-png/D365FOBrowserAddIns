import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from '@shared/types';

// Mock chrome.tabs, chrome.downloads, chrome.commands, chrome.runtime.getURL
// Mock the tracker registry so we can inject a deterministic fake provider
// and assert on provider.submit call shapes.

const tabsMock = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  sendMessage: vi.fn(),
  captureVisibleTab: vi.fn(),
}));

const downloadsMock = vi.hoisted(() => ({ download: vi.fn() }));
const commandsMock = vi.hoisted(() => ({ onCommand: { addListener: vi.fn() } }));
const runtimeMock = vi.hoisted(() => ({
  id: 'test',
  getURL: (p: string) => `chrome-extension://test/${p.replace(/^\//, '')}`,
  sendMessage: vi.fn(),
  onMessage: { addListener: vi.fn() },
}));

const fakeProvider = vi.hoisted(() => ({
  id: 'fake',
  displayName: 'Fake Tracker',
  getConfigSchema: () => ({ fields: [] }),
  validateConfig: vi.fn().mockReturnValue({ ok: true }),
  testConnection: vi.fn().mockResolvedValue({ ok: true, message: 'fake' }),
  submit: vi.fn().mockResolvedValue({
    ticketId: '1',
    ticketNumber: 'FAKE-1',
    ticketUrl: 'https://fake/1',
    raw: {},
  }),
}));

vi.mock('@shared/trackers', async () => {
  const actual = await vi.importActual<typeof import('@shared/trackers')>('@shared/trackers');
  return {
    ...actual,
    TRACKER_PROVIDERS: [fakeProvider],
    getProvider: (id: string) => (id === 'fake' ? fakeProvider : undefined),
  };
});

vi.mock('@shared/trackers/common', async () => {
  const actual = await vi.importActual<typeof import('@shared/trackers/common')>(
    '@shared/trackers/common',
  );
  return {
    ...actual,
    collectAttachments: vi.fn().mockResolvedValue({
      attachments: [{ filename: 'repro.xml', mime: 'application/xml', bytes: new Uint8Array([1]) }],
      xml: '<r/>',
    }),
  };
});

// The service worker imports './full-page-capture' at top level. It contains
// chrome.debugger references which break typechecking in the test environment
// unless we neutralize them.
vi.mock('../../src/background/full-page-capture', () => ({
  captureFullPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array([0, 1])])),
}));

// The messaging module's onMessage() is called at module load to register
// the router. Stub it so our tests don't try to use chrome.runtime.onMessage.
vi.mock('@shared/messaging', async () => {
  const actual = await vi.importActual<typeof import('@shared/messaging')>('@shared/messaging');
  return {
    ...actual,
    onMessage: vi.fn(),
    sendToTab: vi.fn().mockResolvedValue({ ok: true }),
  };
});

import { handleMessage } from '../../src/background/service-worker';
import * as storage from '@shared/storage';

function makeSender(tabId: number | undefined): chrome.runtime.MessageSender {
  return { tab: tabId != null ? ({ id: tabId } as chrome.tabs.Tab) : undefined };
}

async function primeEnvironment(): Promise<void> {
  await storage.setActiveSession(null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Keep the storage stub from setup.ts but swap in our vi.fn-equipped
  // tabs / downloads / commands / runtime hoisted mocks so we can assert on
  // chrome.tabs.create, chrome.downloads.download, etc.
  const existing = (globalThis as unknown as { chrome: typeof chrome }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    ...existing,
    tabs: tabsMock,
    downloads: downloadsMock,
    commands: commandsMock,
    runtime: runtimeMock,
  };
  await chrome.storage.local.clear();
  await primeEnvironment();
  tabsMock.get.mockResolvedValue({ id: 42, windowId: 1 });
  tabsMock.query.mockResolvedValue([{ id: 42, windowId: 1 }]);
  tabsMock.create.mockResolvedValue(undefined);
  tabsMock.sendMessage.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------- lifecycle

describe('handleMessage — session lifecycle', () => {
  it('SESSION_START creates and persists a new session', async () => {
    const env = {
      url: 'https://x.dynamics.com',
      host: 'x.dynamics.com',
      userAgent: 'test',
      extensionVersion: '0.1.0',
      capturedAt: 0,
    };
    const resp = await handleMessage({ type: 'SESSION_START', env }, makeSender(42));
    expect(resp.ok).toBe(true);
    const active = await storage.getActiveSession();
    expect(active?.state).toBe('recording');
    expect(active?.tabId).toBe(42);
  });

  it('SESSION_START is idempotent on an existing recording session', async () => {
    const s = sampleActiveSession();
    await storage.setActiveSession(s);
    const resp = await handleMessage(
      {
        type: 'SESSION_START',
        env: { ...s.environment },
      },
      makeSender(42),
    );
    expect(resp.ok).toBe(true);
    const active = await storage.getActiveSession();
    expect(active?.id).toBe(s.id);
  });

  it('SESSION_START rejects when the sender has no tab', async () => {
    const resp = await handleMessage(
      {
        type: 'SESSION_START',
        env: {
          url: 'https://x',
          host: 'x',
          userAgent: '',
          extensionVersion: '',
          capturedAt: 0,
        },
      },
      makeSender(undefined),
    );
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('no-tab');
  });

  it('SESSION_STOP archives and opens the review tab', async () => {
    await storage.setActiveSession(sampleActiveSession());
    const resp = await handleMessage({ type: 'SESSION_STOP' }, makeSender(42));
    expect(resp.ok).toBe(true);
    expect(await storage.getActiveSession()).toBeNull();
    const arch = await storage.getArchivedSession('ses_test');
    expect(arch?.state).toBe('stopped');
    expect(tabsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('review/review.html#ses_test') }),
    );
  });

  it('SESSION_PAUSE and SESSION_RESUME flip state', async () => {
    await storage.setActiveSession(sampleActiveSession());
    await handleMessage({ type: 'SESSION_PAUSE' }, makeSender(42));
    expect((await storage.getActiveSession())?.state).toBe('paused');
    await handleMessage({ type: 'SESSION_RESUME' }, makeSender(42));
    expect((await storage.getActiveSession())?.state).toBe('recording');
  });
});

// ---------------------------------------------------------------- recovery

describe('handleMessage — recovery', () => {
  it('POPUP_RECOVER_RESUME rebinds to the active tab', async () => {
    await storage.setActiveSession({ ...sampleActiveSession(), tabId: 999 });
    tabsMock.query.mockResolvedValue([{ id: 77 }]);
    const resp = await handleMessage({ type: 'POPUP_RECOVER_RESUME' }, makeSender(77));
    expect(resp.ok).toBe(true);
    expect((await storage.getActiveSession())?.tabId).toBe(77);
  });

  it('POPUP_RECOVER_REVIEW archives and opens review, clearing active slot', async () => {
    await storage.setActiveSession(sampleActiveSession());
    const resp = await handleMessage({ type: 'POPUP_RECOVER_REVIEW' }, makeSender(42));
    expect(resp.ok).toBe(true);
    expect(await storage.getActiveSession()).toBeNull();
    expect((await storage.getArchivedSession('ses_test'))).toBeDefined();
    expect(tabsMock.create).toHaveBeenCalled();
  });

  it('POPUP_RECOVER_DISCARD archives first (never loses data) then clears active', async () => {
    await storage.setActiveSession(sampleActiveSession());
    await handleMessage({ type: 'POPUP_RECOVER_DISCARD' }, makeSender(42));
    expect(await storage.getActiveSession()).toBeNull();
    expect(await storage.getArchivedSession('ses_test')).toBeDefined();
  });
});

// ---------------------------------------------------------------- step events

describe('handleMessage — step events', () => {
  it('appends a STEP_EVENT to the active session', async () => {
    await storage.setActiveSession(sampleActiveSession());
    const resp = await handleMessage(
      {
        type: 'STEP_EVENT',
        step: { kind: 'click', label: 'New', role: 'button' } as unknown as never,
      },
      makeSender(42),
    );
    expect(resp.ok).toBe(true);
    const active = await storage.getActiveSession();
    expect(active?.steps).toHaveLength(1);
    expect(active?.steps[0]?.kind).toBe('click');
  });

  it('rejects STEP_EVENT from a mismatched tab', async () => {
    await storage.setActiveSession(sampleActiveSession());
    const resp = await handleMessage(
      {
        type: 'STEP_EVENT',
        step: { kind: 'click', label: 'X' } as unknown as never,
      },
      makeSender(99),
    );
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('wrong-tab');
  });

  it('rejects STEP_EVENT when paused', async () => {
    const s = { ...sampleActiveSession(), state: 'paused' as const };
    await storage.setActiveSession(s);
    const resp = await handleMessage(
      {
        type: 'STEP_EVENT',
        step: { kind: 'click', label: 'X' } as unknown as never,
      },
      makeSender(42),
    );
    expect(resp.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- review

describe('handleMessage — review', () => {
  it('REVIEW_GET_SESSION returns the active session when matching', async () => {
    await storage.setActiveSession(sampleActiveSession());
    const resp = await handleMessage(
      { type: 'REVIEW_GET_SESSION', sessionId: 'ses_test' },
      makeSender(42),
    );
    expect(resp.ok).toBe(true);
    expect((resp.data as Session).id).toBe('ses_test');
  });

  it('REVIEW_GET_SESSION falls back to archive', async () => {
    const s = sampleActiveSession();
    s.state = 'stopped';
    await storage.archiveSession(s);
    const resp = await handleMessage(
      { type: 'REVIEW_GET_SESSION', sessionId: 'ses_test' },
      makeSender(42),
    );
    expect(resp.ok).toBe(true);
  });

  it('REVIEW_GET_TRACKER_INFO reports the active provider and registry', async () => {
    await storage.setTrackerSettings({
      activeProviderId: 'fake',
      providerConfigs: { fake: {} },
    });
    const resp = await handleMessage({ type: 'REVIEW_GET_TRACKER_INFO' }, makeSender(42));
    expect(resp.ok).toBe(true);
    const data = resp.data as { activeProviderName: string; providers: Array<{ id: string }> };
    expect(data.activeProviderName).toBe('Fake Tracker');
    expect(data.providers).toEqual([{ id: 'fake', displayName: 'Fake Tracker' }]);
  });

  it('REVIEW_SUBMIT_TRACKER with no active provider returns a clear error', async () => {
    const s = sampleActiveSession();
    s.state = 'stopped';
    await storage.archiveSession(s);
    const resp = await handleMessage(
      { type: 'REVIEW_SUBMIT_TRACKER', sessionId: 'ses_test' },
      makeSender(42),
    );
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/No tracker selected/);
  });

  it('REVIEW_SUBMIT_TRACKER calls provider.submit and returns its result', async () => {
    const s = sampleActiveSession();
    s.state = 'stopped';
    await storage.archiveSession(s);
    await storage.setTrackerSettings({
      activeProviderId: 'fake',
      providerConfigs: { fake: { anything: 'goes' } },
    });
    const resp = await handleMessage(
      { type: 'REVIEW_SUBMIT_TRACKER', sessionId: 'ses_test' },
      makeSender(42),
    );
    expect(resp.ok).toBe(true);
    expect(fakeProvider.submit).toHaveBeenCalledTimes(1);
    const data = resp.data as { providerName: string; ticketNumber: string };
    expect(data.providerName).toBe('Fake Tracker');
    expect(data.ticketNumber).toBe('FAKE-1');
  });

  it('REVIEW_REPLACE_SNAPSHOT does not stack [redacted] markers', async () => {
    const s = sampleActiveSession();
    s.steps.push({
      kind: 'navigate',
      id: 'st1',
      ts: 0,
      url: 'x',
      screenshotId: 'img-1',
      note: 'first',
    });
    await storage.setActiveSession(s);
    await storage.putSnapshot({
      id: 'img-1',
      sessionId: 'ses_test',
      ts: 0,
      mime: 'image/png',
      data: new Blob([new Uint8Array([1])]),
    });

    const pngDataUrl =
      'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    // First redaction adds the marker
    await handleMessage(
      { type: 'REVIEW_REPLACE_SNAPSHOT', sessionId: 'ses_test', snapshotId: 'img-1', pngDataUrl },
      makeSender(42),
    );
    // Second redaction must NOT stack a second marker
    await handleMessage(
      { type: 'REVIEW_REPLACE_SNAPSHOT', sessionId: 'ses_test', snapshotId: 'img-1', pngDataUrl },
      makeSender(42),
    );
    const updated = await storage.getActiveSession();
    const step = updated!.steps.find((x) => x.id === 'st1') as { note?: string };
    expect(step.note?.match(/\[redacted\]/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------- helpers

function sampleActiveSession(): Session {
  return {
    id: 'ses_test',
    tabId: 42,
    state: 'recording',
    startedAt: 1_700_000_000_000,
    title: '',
    description: '',
    severity: 'med',
    tags: [],
    environment: {
      url: 'https://x.dynamics.com',
      host: 'x.dynamics.com',
      userAgent: 'test',
      extensionVersion: '0.1.0',
      capturedAt: 0,
    },
    steps: [],
  };
}
