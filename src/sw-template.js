/*
 * Duck Call Coach service worker: makes the app work with no signal after the first load.
 * The build (src/build/serviceWorker.ts) fills in VERSION and ASSETS and writes this out as sw.js.
 * Plain JavaScript with no imports, served from the app's own origin.
 */

const VERSION = "__VERSION__";
/** Every file of this deploy, relative to the worker's scope. */
const ASSETS = __ASSETS__;

// Other GitHub Pages sites share this origin and its Cache Storage, so only caches with this prefix are ours.
const CACHE_PREFIX = "duck-call-coach-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
/** On a weak signal, give up on the network after this long and open the app from the cache. */
const NAVIGATION_TIMEOUT_MS = 3000;
const SCOPE_PATH = new URL("./", self.location.href).pathname;
const DIAGNOSTICS_PAGE = "diagnostics.html";
/**
 * Pages opened before an update keep running the old version's code, and load some of its files only later (the
 * analysis worker, the recording worklet). The deploy has removed those files from the server, so the previous
 * version's cache is kept for them.
 */
const PREVIOUS_VERSIONS_KEPT = 1;
/** Each version's cache records when its install finished, under a URL outside the scope so no page can ask for it. */
const INSTALLED_AT_KEY = new URL(`/${CACHE_PREFIX}installed-at`, self.location.origin).href;

function scopedUrl(path) {
  return new URL(path, self.location.href).href;
}

self.addEventListener("install", (event) => {
  // A new deploy takes over at once, so it is in use from the next launch.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  event.respondWith(request.mode === "navigate" ? networkFirst(request, url) : cacheFirst(request, event));
});

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  // "reload" skips the HTTP cache, so every file comes from this deploy. One failure fails the install.
  await cache.addAll(ASSETS.map((path) => new Request(scopedUrl(path), { cache: "reload" })));
  // Written last, so a cache left half-filled by a failed install has no date and is the first to go.
  await cache.put(INSTALLED_AT_KEY, new Response(String(Date.now())));
}

/** Names of this app's caches from other versions. */
async function otherVersionCaches() {
  const names = await caches.keys();
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
}

async function installedAt(name) {
  const record = await (await caches.open(name)).match(INSTALLED_AT_KEY);
  const time = record ? Number(await record.text()) : 0;
  return Number.isFinite(time) ? time : 0;
}

/** Keeps this version and the newest previous one; deletes the rest. */
async function deleteOldCaches() {
  const others = await otherVersionCaches();
  const dated = await Promise.all(others.map(async (name) => ({ name, time: await installedAt(name) })));
  dated.sort((a, b) => b.time - a.time);
  await Promise.all(dated.slice(PREVIOUS_VERSIONS_KEPT).map(({ name }) => caches.delete(name)));
}

/** This version's copy, else a kept previous version's, for pages still running that version. */
async function cachedResponse(request) {
  // Each URL has one content per deploy, so ignore Vary: a server's "Vary: Origin" would otherwise make
  // <script type="module" crossorigin> (which sends Origin) miss files precached without it.
  const options = { ignoreVary: true };
  const current = await (await caches.open(CACHE_NAME)).match(request, options);
  if (current) return current;
  for (const name of await otherVersionCaches()) {
    const previous = await (await caches.open(name)).match(request, options);
    if (previous) return previous;
  }
  return undefined;
}

/**
 * Pages: the newest copy when the network answers in time, otherwise the cached page. "no-cache" makes the
 * browser check with the server rather than reuse its own copy from the last few minutes, which may name files
 * a deploy has removed. A 404 is a real answer and is shown; a server error is worse than the cached app.
 */
async function networkFirst(request, url) {
  let response;
  try {
    response = await fetchWithTimeout(new Request(request, { cache: "no-cache" }), NAVIGATION_TIMEOUT_MS);
  } catch {
    return (await cachedPage(url)) ?? Response.error();
  }
  if (response.status >= 500) return (await cachedPage(url)) ?? response;
  return response;
}

function cachedPage(url) {
  const page = url.pathname.endsWith(`/${DIAGNOSTICS_PAGE}`) ? DIAGNOSTICS_PAGE : "index.html";
  return cachedResponse(scopedUrl(page));
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), timeoutMs);
    fetch(request)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Everything else: a cached copy, or the network. A good same-origin answer is kept for next time, in the
 * background, so the page gets it without waiting for the write.
 */
async function cacheFirst(request, event) {
  const cached = await cachedResponse(request);
  if (cached) {
    const range = request.headers.get("Range");
    return range === null ? cached : rangeResponse(cached, range);
  }
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") {
    const copy = response.clone();
    // A failed write (out of space, for example) doesn't matter: the answer is still good to use.
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(request, copy))
        .catch(() => undefined),
    );
  }
  return response;
}

/**
 * Audio elements ask for byte ranges, and Safari won't play a clip answered with the whole file, so cut the
 * cached copy. Handles one range ("bytes=a-b", "bytes=a-", "bytes=-n"); anything else gets the whole file,
 * which HTTP allows.
 */
async function rangeResponse(cached, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return cached;
  const body = await cached.blob();
  const size = body.size;
  let start;
  let end;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const headers = new Headers(cached.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
}
