import type { ClickSamplesApi, ClickSampleSlot, StoredClickSample } from "@shared/host/click-samples";

/** Browser build: the sample files live in IndexedDB, one record per slot. */
const DB = "vltn-click-samples";
const STORE = "samples";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the sample store."));
  });
}

async function run<T>(mode: IDBTransactionMode, job: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = job(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("The sample store failed."));
    });
  } finally {
    db.close();
  }
}

export const webClickSamples: ClickSamplesApi = {
  get: async (slot: ClickSampleSlot) => ((await run("readonly", (store) => store.get(slot))) as StoredClickSample | undefined) ?? null,
  put: async (slot, sample) => void (await run("readwrite", (store) => store.put({ name: sample.name, bytes: sample.bytes }, slot))),
  clear: async (slot) => void (await run("readwrite", (store) => store.delete(slot))),
};
