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
  event.respondWith(request.mode === "navigate" ? networkFirst(request, url) : cacheFirst(request));
});

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  // "reload" skips the HTTP cache, so every file comes from this deploy. One failure fails the install.
  await cache.addAll(ASSETS.map((path) => new Request(scopedUrl(path), { cache: "reload" })));
}

async function deleteOldCaches() {
  const names = await caches.keys();
  const old = names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
  await Promise.all(old.map((name) => caches.delete(name)));
}

/** Pages: the newest copy when the network answers in time, otherwise the precached page. */
async function networkFirst(request, url) {
  try {
    return await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
  } catch {
    const page = url.pathname.endsWith(`/${DIAGNOSTICS_PAGE}`) ? DIAGNOSTICS_PAGE : "index.html";
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(scopedUrl(page))) ?? Response.error();
  }
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), timeoutMs);
    fetch(request)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/** Everything else: the cached copy, or the network (keeping a good same-origin answer for next time). */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // Each URL has one content per deploy, so ignore Vary: a server's "Vary: Origin" would otherwise make
  // <script type="module" crossorigin> (which sends Origin) miss files precached without it.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    const range = request.headers.get("Range");
    return range === null ? cached : rangeResponse(cached, range);
  }
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Out of space, for example: the answer is still good to use.
    }
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
