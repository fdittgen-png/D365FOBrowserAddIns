import type { Session, SnapshotBlob, RecordingOptions } from './types';
import type { TrackerSettings } from './trackers/settings';
import { DEFAULT_TRACKER_SETTINGS } from './trackers/settings';
import { DEFAULT_OPTIONS } from './types';

/**
 * Session metadata lives in chrome.storage.local so it survives service-worker
 * restarts and full-page navigations (including AAD redirects). Snapshot blobs
 * live in IndexedDB because chrome.storage is not designed for binary data.
 */

const SESSION_KEY = 'activeSession';
const OPTIONS_KEY = 'options';
const TRACKER_KEY = 'trackerSettings';
const LEGACY_OTRS_KEY = 'otrs';
const DB_NAME = 'd365fo-repro';
const DB_VERSION = 1;
const STORE_SNAP = 'snapshots';
const STORE_ARCHIVE = 'archived-sessions';

// ----- chrome.storage.local -----

export async function getActiveSession(): Promise<Session | null> {
  const out = await chrome.storage.local.get(SESSION_KEY);
  return (out[SESSION_KEY] as Session | undefined) ?? null;
}

export async function setActiveSession(session: Session | null): Promise<void> {
  if (session === null) {
    await chrome.storage.local.remove(SESSION_KEY);
  } else {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  }
}

export async function getOptions(): Promise<RecordingOptions> {
  const out = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...((out[OPTIONS_KEY] as RecordingOptions | undefined) ?? {}) };
}

export async function setOptions(opts: RecordingOptions): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: opts });
}

export async function getTrackerSettings(): Promise<TrackerSettings> {
  const out = await chrome.storage.local.get([TRACKER_KEY, LEGACY_OTRS_KEY]);
  const stored = out[TRACKER_KEY] as TrackerSettings | undefined;
  if (stored) {
    return {
      activeProviderId: stored.activeProviderId ?? null,
      providerConfigs: stored.providerConfigs ?? {},
    };
  }
  // One-time migration from the flat otrs key
  const legacy = out[LEGACY_OTRS_KEY] as Record<string, unknown> | undefined;
  if (legacy) {
    const migrated: TrackerSettings = {
      activeProviderId: 'otrs',
      providerConfigs: { otrs: legacy },
    };
    await chrome.storage.local.set({ [TRACKER_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_OTRS_KEY);
    return migrated;
  }
  return { ...DEFAULT_TRACKER_SETTINGS };
}

export async function setTrackerSettings(settings: TrackerSettings): Promise<void> {
  await chrome.storage.local.set({ [TRACKER_KEY]: settings });
}

// ----- IndexedDB for snapshots -----

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAP)) {
        const s = db.createObjectStore(STORE_SNAP, { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ARCHIVE)) {
        db.createObjectStore(STORE_ARCHIVE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putSnapshot(snap: SnapshotBlob): Promise<void> {
  await tx(STORE_SNAP, 'readwrite', (s) => s.put(snap));
}

export async function getSnapshot(id: string): Promise<SnapshotBlob | undefined> {
  return tx<SnapshotBlob | undefined>(STORE_SNAP, 'readonly', (s) => s.get(id));
}

export async function getSnapshotsBySession(sessionId: string): Promise<SnapshotBlob[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SNAP, 'readonly');
    const store = t.objectStore(STORE_SNAP);
    const idx = store.index('sessionId');
    const req = idx.getAll(sessionId);
    req.onsuccess = () => resolve(req.result as SnapshotBlob[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSnapshotsBySession(sessionId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SNAP, 'readwrite');
    const store = t.objectStore(STORE_SNAP);
    const idx = store.index('sessionId');
    const req = idx.openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
    t.oncomplete = () => resolve();
  });
}

export async function archiveSession(session: Session): Promise<void> {
  await tx(STORE_ARCHIVE, 'readwrite', (s) => s.put(session));
}

export async function getArchivedSession(id: string): Promise<Session | undefined> {
  return tx<Session | undefined>(STORE_ARCHIVE, 'readonly', (s) => s.get(id));
}
