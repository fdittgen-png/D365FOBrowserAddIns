import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveSession,
  setActiveSession,
  getOptions,
  setOptions,
  getTrackerSettings,
  setTrackerSettings,
  putSnapshot,
  getSnapshot,
  getSnapshotsBySession,
  deleteSnapshotsBySession,
  archiveSession,
  getArchivedSession,
} from '@shared/storage';
import type { Session, SnapshotBlob } from '@shared/types';
import { DEFAULT_OPTIONS } from '@shared/types';

function freshSession(id = 'ses1'): Session {
  return {
    id,
    tabId: 1,
    state: 'recording',
    startedAt: Date.now(),
    title: '',
    description: '',
    severity: 'med',
    tags: [],
    environment: {
      url: 'https://example.dynamics.com/',
      host: 'example.dynamics.com',
      userAgent: 'test',
      extensionVersion: '0.1.0',
      capturedAt: Date.now(),
    },
    steps: [],
  };
}

beforeEach(async () => {
  await chrome.storage.local.clear();
});

describe('active session persistence', () => {
  it('round-trips a session through chrome.storage.local', async () => {
    await setActiveSession(freshSession('ses-a'));
    const loaded = await getActiveSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('ses-a');
  });

  it('returns null when no active session is stored', async () => {
    expect(await getActiveSession()).toBeNull();
  });

  it('setActiveSession(null) clears the slot', async () => {
    await setActiveSession(freshSession('ses-b'));
    await setActiveSession(null);
    expect(await getActiveSession()).toBeNull();
  });

  it('a session written before a SW restart is still readable — the recovery flow', async () => {
    const s = freshSession('ses-crashed');
    s.steps.push({ kind: 'click', id: 'c1', ts: Date.now(), label: 'New' });
    await setActiveSession(s);
    // simulate a service worker restart: module re-evaluation, storage persists
    const reloaded = await getActiveSession();
    expect(reloaded?.steps).toHaveLength(1);
    expect(reloaded?.state).toBe('recording');
  });
});

describe('recording options', () => {
  it('returns defaults when nothing is stored', async () => {
    const opts = await getOptions();
    expect(opts).toEqual(DEFAULT_OPTIONS);
  });

  it('merges stored options over defaults', async () => {
    await setOptions({ ...DEFAULT_OPTIONS, autoSnapOnClick: true });
    const opts = await getOptions();
    expect(opts.autoSnapOnClick).toBe(true);
    expect(opts.autoSnapOnNavigate).toBe(DEFAULT_OPTIONS.autoSnapOnNavigate);
  });
});

describe('tracker settings', () => {
  it('returns empty defaults when nothing is stored', async () => {
    const settings = await getTrackerSettings();
    expect(settings.activeProviderId).toBeNull();
    expect(settings.providerConfigs).toEqual({});
  });

  it('migrates a legacy flat otrs key into providerConfigs.otrs', async () => {
    await chrome.storage.local.set({
      otrs: {
        baseUrl: 'https://otrs.example.com',
        webservice: 'Generic',
        user: 'u',
        password: 'p',
        queue: 'Q',
        type: 'Incident',
        priority: '3 normal',
        state: 'new',
      },
    });
    const settings = await getTrackerSettings();
    expect(settings.activeProviderId).toBe('otrs');
    expect(settings.providerConfigs.otrs).toMatchObject({ baseUrl: 'https://otrs.example.com' });
    // Legacy key is removed after migration
    const raw = await chrome.storage.local.get('otrs');
    expect(raw.otrs).toBeUndefined();
  });

  it('does not clobber existing tracker settings during migration check', async () => {
    await setTrackerSettings({
      activeProviderId: 'jira',
      providerConfigs: { jira: { siteUrl: 'https://a.atlassian.net' } },
    });
    const settings = await getTrackerSettings();
    expect(settings.activeProviderId).toBe('jira');
  });
});

describe('snapshot IndexedDB store', () => {
  it('stores and retrieves snapshots by id', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const snap: SnapshotBlob = { id: 'img-1', sessionId: 'ses-x', ts: 1, mime: 'image/png', data: blob };
    await putSnapshot(snap);
    const loaded = await getSnapshot('img-1');
    expect(loaded?.id).toBe('img-1');
  });

  it('getSnapshotsBySession returns all snapshots for a session', async () => {
    const blob = new Blob([new Uint8Array([0])]);
    await putSnapshot({ id: 'a', sessionId: 'ses-y', ts: 1, mime: 'image/png', data: blob });
    await putSnapshot({ id: 'b', sessionId: 'ses-y', ts: 2, mime: 'image/png', data: blob });
    await putSnapshot({ id: 'c', sessionId: 'ses-z', ts: 3, mime: 'image/png', data: blob });
    const list = await getSnapshotsBySession('ses-y');
    expect(list.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('deleteSnapshotsBySession removes only the matching session', async () => {
    const blob = new Blob([new Uint8Array([0])]);
    await putSnapshot({ id: 'd', sessionId: 'ses-del', ts: 1, mime: 'image/png', data: blob });
    await putSnapshot({ id: 'e', sessionId: 'ses-keep', ts: 2, mime: 'image/png', data: blob });
    await deleteSnapshotsBySession('ses-del');
    expect(await getSnapshot('d')).toBeUndefined();
    expect((await getSnapshot('e'))?.id).toBe('e');
  });
});

describe('archived sessions', () => {
  it('archives a session and retrieves it by id', async () => {
    const s = freshSession('ses-arch');
    s.state = 'stopped';
    await archiveSession(s);
    const loaded = await getArchivedSession('ses-arch');
    expect(loaded?.id).toBe('ses-arch');
  });
});
