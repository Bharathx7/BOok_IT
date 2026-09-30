// A small in-process cache for hot public reads (venue pages, popular list).
//
// Deliberately not Redis: the API runs as a single instance and Phase 2 chose
// to avoid a separate Redis service. Entries expire after a short TTL and
// are dropped explicitly when the data changes, so a second instance would
// at worst serve data a TTL old. Swap this module for a shared store if the
// API ever runs on several instances.

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_ENTRIES = 1000;

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<unknown>>();
let hits = 0;
let misses = 0;

/**
 * Returns the cached value for `key`, or runs `load` once (concurrent callers
 * share the same load) and keeps the result for `ttlMs`.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    hits++;
    return entry.value as T;
  }

  const inFlight = loading.get(key);
  if (inFlight) return inFlight as Promise<T>;

  misses++;
  const promise = load()
    .then((value) => {
      // Only keep it if nobody invalidated the key while it was loading.
      if (loading.get(key) === promise) {
        entries.delete(key);
        entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
      }
      return value;
    })
    .finally(() => {
      if (loading.get(key) === promise) loading.delete(key);
    });

  loading.set(key, promise);
  return promise;
}

/** Drops every key that starts with `prefix` (e.g. "venue:" + id). */
export function invalidate(prefix: string) {
  for (const key of [...entries.keys(), ...loading.keys()]) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
      loading.delete(key);
    }
  }
}

export function cacheStats() {
  return { entries: entries.size, hits, misses };
}

/** Tests only. */
export function clearCache() {
  entries.clear();
  loading.clear();
  hits = 0;
  misses = 0;
}
