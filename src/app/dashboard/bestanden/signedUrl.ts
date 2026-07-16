// src/app/dashboard/bestanden/signedUrl.ts
// [F#1/F#3] Shared, de-duplicated, concurrency-limited fetching of document signed
// URLs. Private files need a 1-hour signed URL (GET /api/files/[id]/url). Without a
// shared layer every image card fired its own request on mount (a "thundering herd"
// of N auth+sign calls for a folder of N photos) and re-fetched on every remount
// (sort / scroll / view switch). This module:
//   - caches by document id with a TTL comfortably under the 1h expiry,
//   - de-dupes concurrent requests for the same id (one in-flight promise),
//   - caps total concurrency so a big folder can't open hundreds of sockets at once.

const TTL_MS = 50 * 60 * 1000; // refresh well before the 1h signed-URL expiry
const MAX_CONCURRENT = 6;

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(() => { active++; resolve(); }));
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Returns a signed URL for a document, cached for ~50 min. Concurrent callers for the
 * same id share one request; total concurrency is capped. Returns null on failure.
 */
export function getSignedUrl(docId: string): Promise<string | null> {
  const cached = cache.get(docId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);

  const existing = inflight.get(docId);
  if (existing) return existing;

  const p = (async (): Promise<string | null> => {
    await acquire();
    try {
      const r = await fetch(`/api/files/${docId}/url`);
      const { url } = (await r.json()) as { url?: string };
      if (url) {
        cache.set(docId, { url, expiresAt: Date.now() + TTL_MS });
        return url;
      }
      return null;
    } catch {
      return null;
    } finally {
      release();
      inflight.delete(docId);
    }
  })();

  inflight.set(docId, p);
  return p;
}
