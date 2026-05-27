import { DB_NAME, DB_VERSION, STORE_VIDEOS } from "../shared/constants";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        const store = db.createObjectStore(STORE_VIDEOS, { keyPath: "id" });
        store.createIndex("addedTo", "addedTo", { unique: false });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("order", "order", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  return dbPromise;
}

export async function runTx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result: T;
    let settled = false;
    tx.oncomplete = () => {
      if (!settled) resolve(result);
    };
    tx.onerror = () => {
      settled = true;
      reject(tx.error);
    };
    tx.onabort = () => {
      settled = true;
      reject(tx.error ?? new Error("Transaction aborted"));
    };
    Promise.resolve(fn(tx))
      .then((v) => {
        result = v;
      })
      .catch((err) => {
        settled = true;
        try {
          tx.abort();
        } catch {
          // ignore
        }
        reject(err);
      });
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
