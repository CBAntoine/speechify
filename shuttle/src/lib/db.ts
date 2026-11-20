// IndexedDB storage. Recordings live entirely in this browser profile.
//
// stores:
//   recordings  id -> Recording (metadata, transcript, edits, thumbnail)
//   media       "<id>:main" | "<id>:cam" -> Blob
//   analysis    id -> Analysis (audio envelope for waveform + silence detection)
//   sessions    id -> RecoverySession (a recording in progress)
//   chunks      auto key -> ChunkRecord (MediaRecorder output written as it arrives)

import type { Analysis, ChunkRecord, MediaKind, Recording, RecoverySession } from './types.ts';

const DB_NAME = 'shuttle';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('analysis')) db.createObjectStore('analysis', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: 'key', autoIncrement: true });
        s.createIndex('session', 'session');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Shuttle tabs to finish updating storage.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await open();
  const tx = db.transaction(name, mode);
  return { tx, s: tx.objectStore(name) };
}

// ------------------------------------------------------------ recordings

export async function listRecordings(): Promise<Recording[]> {
  const { s } = await store('recordings');
  const all = await wrap(s.getAll() as IDBRequest<Recording[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecording(id: string): Promise<Recording | undefined> {
  const { s } = await store('recordings');
  return wrap(s.get(id) as IDBRequest<Recording | undefined>);
}

export async function putRecording(rec: Recording): Promise<void> {
  const { tx, s } = await store('recordings', 'readwrite');
  s.put(rec);
  await done(tx);
}

/** Merges fields into the stored record inside one transaction. */
export async function patchRecording(id: string, patch: Partial<Recording>): Promise<void> {
  const { tx, s } = await store('recordings', 'readwrite');
  const req = s.get(id);
  req.onsuccess = () => {
    if (req.result) s.put({ ...(req.result as Recording), ...patch });
  };
  await done(tx);
}

export async function saveNewRecording(rec: Recording, media: Partial<Record<MediaKind, Blob>>): Promise<void> {
  const db = await open();
  const tx = db.transaction(['recordings', 'media'], 'readwrite');
  tx.objectStore('recordings').put(rec);
  for (const [kind, blob] of Object.entries(media)) if (blob) tx.objectStore('media').put(blob, `${rec.id}:${kind}`);
  await done(tx);
}

export async function getMedia(id: string, kind: MediaKind): Promise<Blob | undefined> {
  const { s } = await store('media');
  return wrap(s.get(`${id}:${kind}`) as IDBRequest<Blob | undefined>);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['recordings', 'media', 'analysis'], 'readwrite');
  tx.objectStore('recordings').delete(id);
  tx.objectStore('media').delete(`${id}:main`);
  tx.objectStore('media').delete(`${id}:cam`);
  tx.objectStore('analysis').delete(id);
  await done(tx);
}

export async function getAnalysis(id: string): Promise<Analysis | undefined> {
  const { s } = await store('analysis');
  return wrap(s.get(id) as IDBRequest<Analysis | undefined>);
}

export async function putAnalysis(a: Analysis): Promise<void> {
  const { tx, s } = await store('analysis', 'readwrite');
  s.put(a);
  await done(tx);
}

// ------------------------------------------------------------ crash recovery

export async function putSession(sess: RecoverySession): Promise<void> {
  const { tx, s } = await store('sessions', 'readwrite');
  s.put(sess);
  await done(tx);
}

export async function listSessions(): Promise<RecoverySession[]> {
  const { s } = await store('sessions');
  return wrap(s.getAll() as IDBRequest<RecoverySession[]>);
}

export async function addChunk(chunk: ChunkRecord): Promise<void> {
  const { tx, s } = await store('chunks', 'readwrite');
  s.add(chunk);
  await done(tx);
}

export async function sessionChunks(sessionId: string): Promise<ChunkRecord[]> {
  const { s } = await store('chunks');
  const all = await wrap(s.index('session').getAll(sessionId) as IDBRequest<ChunkRecord[]>);
  return all.sort((a, b) => a.seq - b.seq);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
  tx.objectStore('sessions').delete(sessionId);
  const idx = tx.objectStore('chunks').index('session');
  const req = idx.openKeyCursor(IDBKeyRange.only(sessionId));
  req.onsuccess = () => {
    const cur = req.result;
    if (cur) {
      tx.objectStore('chunks').delete(cur.primaryKey);
      cur.continue();
    }
  };
  await done(tx);
}

// ------------------------------------------------------------ quota

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict recordings under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
