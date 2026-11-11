// Kho IndexedDB cho engine: ghi chú cục bộ + metadata (con trỏ sự kiện). Mỗi người dùng một cơ sở dữ liệu riêng.
import type { LocalNote, Store } from "./types.ts";

export function openIdbStore(dbName: string): Store {
  const dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("notes", { keyPath: "key" });
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function run<T>(storeName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await dbp;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    all: () => run<LocalNote[]>("notes", "readonly", (s) => s.getAll() as IDBRequest<LocalNote[]>),
    put: async (note) => {
      await run("notes", "readwrite", (s) => s.put(note));
    },
    remove: async (key) => {
      await run("notes", "readwrite", (s) => s.delete(key));
    },
    getMeta: (key) => run<unknown>("meta", "readonly", (s) => s.get(key)),
    setMeta: async (key, value) => {
      await run("meta", "readwrite", (s) => s.put(value, key));
    },
  };
}
