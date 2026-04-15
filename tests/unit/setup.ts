import { vi } from 'vitest';

type StorageRecord = Record<string, unknown>;
const localStore: StorageRecord = {};

function makeArea(store: StorageRecord): chrome.storage.StorageArea {
  return {
    get: vi.fn((keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return Promise.resolve({ ...store });
      if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
      if (Array.isArray(keys)) {
        const out: StorageRecord = {};
        for (const k of keys) out[k] = store[k];
        return Promise.resolve(out);
      }
      const out: StorageRecord = {};
      for (const k of Object.keys(keys)) out[k] = store[k] ?? (keys as StorageRecord)[k];
      return Promise.resolve(out);
    }),
    set: vi.fn((items: StorageRecord) => {
      Object.assign(store, items);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete store[k];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
      return Promise.resolve();
    }),
  } as unknown as chrome.storage.StorageArea;
}

(globalThis as unknown as { chrome: Partial<typeof chrome> }).chrome = {
  storage: {
    local: makeArea(localStore),
    session: makeArea({}),
    sync: makeArea({}),
  } as unknown as typeof chrome.storage,
  runtime: {
    id: 'test-extension-id',
    getURL: (p: string) => `chrome-extension://test-extension-id/${p.replace(/^\//, '')}`,
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  } as unknown as typeof chrome.runtime,
  permissions: {
    contains: vi.fn().mockResolvedValue(true),
    request: vi.fn().mockResolvedValue(true),
  } as unknown as typeof chrome.permissions,
  commands: {
    onCommand: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn() },
    getAll: vi.fn().mockResolvedValue([]),
  } as unknown as typeof chrome.commands,
  tabs: {
    get: vi.fn(),
    create: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    captureVisibleTab: vi.fn(),
  } as unknown as typeof chrome.tabs,
  downloads: {
    download: vi.fn(),
  } as unknown as typeof chrome.downloads,
};

// jsdom doesn't provide crypto.getRandomValues in older versions — polyfill if missing
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.getRandomValues !== 'function') {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Use fake-indexeddb for storage tests that touch IDB
try {
  // Dynamic import path to avoid hard-coding the subpath export which some
  // package.json configurations reject; fall back to the root module.
  await import(/* @vite-ignore */ 'fake-indexeddb/auto' as string).catch(async () => {
    const mod = (await import('fake-indexeddb')) as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = mod.indexedDB;
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = mod.IDBKeyRange;
  });
} catch {
  // module optional — tests that need it will fail loudly on first use
}
