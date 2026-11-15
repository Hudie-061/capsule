// Tiny IndexedDB wrapper: a JSON key-value store and a blob store.
// Everything the app owns (wardrobe, import jobs, images, profile, ratings) lives on the device.
const DB_NAME = "capsule-wardrobe";
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kv = {
  get: (key, fallback = null) => run("kv", "readonly", (s) => s.get(key)).then((v) => (v === undefined ? fallback : v)),
  set: (key, value) => run("kv", "readwrite", (s) => s.put(value, key)),
  del: (key) => run("kv", "readwrite", (s) => s.delete(key)),
  keys: () => run("kv", "readonly", (s) => s.getAllKeys()),
};

export const blobs = {
  get: (key) => run("blobs", "readonly", (s) => s.get(key)),
  set: (key, blob) => run("blobs", "readwrite", (s) => s.put(blob, key)),
  del: (key) => run("blobs", "readwrite", (s) => s.delete(key)),
  keys: () => run("blobs", "readonly", (s) => s.getAllKeys()),
};

// Stored image paths look like "asset:<id>/<name>.png". The UI needs real URLs,
// so they are turned into object URLs on demand and cached for the session.
const urlCache = new Map();
export async function assetUrl(path) {
  if (!path || typeof path !== "string" || !path.startsWith("asset:")) return path;
  if (urlCache.has(path)) return urlCache.get(path);
  const blob = await blobs.get(path);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  return url;
}

export function forgetAssetUrl(path) {
  const url = urlCache.get(path);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(path);
}

export async function deleteAssetsWithPrefix(prefix) {
  const keys = await blobs.keys();
  await Promise.all(keys.filter((key) => String(key).startsWith(prefix)).map((key) => {
    forgetAssetUrl(key);
    return blobs.del(key);
  }));
}
