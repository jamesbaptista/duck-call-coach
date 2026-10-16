import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderServiceWorker } from "../../src/build/serviceWorker";

/** Runs src/sw-template.js against a fake service worker global, network and Cache Storage. */

const ORIGIN = "https://example.github.io";
const SCOPE = `${ORIGIN}/duck-call-coach/`;
const VERSION = "0123456789ab";
const CACHE_NAME = `duck-call-coach-${VERSION}`;
const ASSETS = ["./", "./index.html", "./diagnostics.html", "./assets/main-a.js", "./assets/varied.js", "./clips/hail.mp3"];
const CLIP = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Requests and responses are keyed by absolute URL; a relative URL here means the worker forgot to resolve one. */
function keyOf(input: Request | string): string {
  return new URL(typeof input === "string" ? input : input.url).href;
}

function headersOf(input: Request | string): Headers {
  return typeof input === "string" ? new Headers() : input.headers;
}

/** Like the real Cache, a stored response with a Vary header only matches requests with the same values. */
class FakeCache {
  readonly entries = new Map<string, Response>();
  private readonly storedHeaders = new Map<string, Headers>();
  /** While set, put() waits for it: lets a test see whether the worker answers before the write finishes. */
  holdPuts: Promise<void> | null = null;

  constructor(private readonly network: (request: Request) => Promise<Response>) {}

  async match(input: Request | string, options: CacheQueryOptions = {}): Promise<Response | undefined> {
    const key = keyOf(input);
    const response = this.entries.get(key);
    if (response === undefined) return undefined;
    if (!options.ignoreVary) {
      const varied = (response.headers.get("Vary") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
      const stored = this.storedHeaders.get(key) ?? new Headers();
      const wanted = headersOf(input);
      if (varied.some((name) => name === "*" || stored.get(name) !== wanted.get(name))) return undefined;
    }
    return response.clone();
  }

  async put(input: Request | string, response: Response): Promise<void> {
    if (response.status === 206) throw new TypeError("partial responses can't be cached");
    if (this.holdPuts) await this.holdPuts;
    this.store(input, response);
  }

  async addAll(requests: Request[]): Promise<void> {
    const responses = await Promise.all(requests.map((request) => this.network(request)));
    if (responses.some((response) => !response.ok)) throw new TypeError("addAll: a request failed");
    requests.forEach((request, i) => this.store(request, responses[i]));
  }

  private store(input: Request | string, response: Response): void {
    this.entries.set(keyOf(input), response);
    this.storedHeaders.set(keyOf(input), headersOf(input));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  constructor(private readonly network: (request: Request) => Promise<Response>) {}

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache(this.network);
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  names(): string[] {
    return [...this.caches.keys()].sort();
  }
}

/** A same-origin network response, as `fetch` gives the worker (Node's own Responses say "default"). */
function basic(body: BodyInit | null, init: ResponseInit = {}, type: ResponseType = "basic"): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { value: type });
  return response;
}

type FetchMock = ReturnType<typeof vi.fn<(input: Request | string) => Promise<Response>>>;

/** The server: answers every path, except files a later deploy removed. */
function fakeNetwork(removed = new Set<string>()): FetchMock {
  return vi.fn(async (input: Request | string): Promise<Response> => {
    const path = new URL(keyOf(input)).pathname;
    if (removed.has(path) || path.endsWith("/missing.js")) return basic("not found", { status: 404 });
    if (path === "/duck-call-coach/clips/hail.mp3") return basic(CLIP, { headers: { "Content-Type": "audio/mpeg" } });
    if (path.endsWith("/varied.js")) return basic(`network ${path}`, { headers: { Vary: "Origin" } });
    return basic(`network ${path}`, { headers: { "Content-Type": "text/html" } });
  });
}

interface Harness {
  storage: FakeCacheStorage;
  fetch: FetchMock;
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  /** Fires an install or activate event and waits for everything passed to waitUntil. */
  lifecycle(type: "install" | "activate"): Promise<void>;
  /** Fires a fetch event: the promise passed to respondWith, or undefined when the worker let it through. */
  request(request: Request): Promise<Response> | undefined;
  /** Waits for the work fetch events passed to waitUntil (cache writes). */
  idle(): Promise<void>;
}

interface WorkerOptions {
  version?: string;
  assets?: readonly string[];
  /** Pass the same network and storage to several versions, as on one phone across deploys. */
  fetch?: FetchMock;
  storage?: FakeCacheStorage;
}

function startWorker(options: WorkerOptions = {}): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const fetch = options.fetch ?? fakeNetwork();
  const storage = options.storage ?? new FakeCacheStorage((request) => fetch(request));
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const background: Promise<unknown>[] = [];
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting,
    clients: { claim },
  };
  const template = readFileSync("src/sw-template.js", "utf8");
  const source = renderServiceWorker(template, options.version ?? VERSION, options.assets ?? ASSETS);
  // Date comes from this context, so vi.setSystemTime decides the order of installs.
  const globals = { self, caches: storage, fetch, Request, Response, Headers, URL, Date, setTimeout, clearTimeout };
  runInNewContext(source, globals);

  return {
    storage,
    fetch,
    skipWaiting,
    claim,
    async lifecycle(type) {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
    },
    request(request) {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")?.({
        request,
        respondWith: (promise: Promise<Response>) => (response = promise),
        waitUntil: (promise: Promise<unknown>) => background.push(promise),
      });
      return response;
    },
    async idle() {
      await Promise.all(background);
    },
  };
}

function navigation(path: string): Request {
  const request = new Request(`${ORIGIN}${path}`);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

async function installed(options: WorkerOptions = {}): Promise<Harness> {
  const worker = startWorker(options);
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  worker.fetch.mockClear();
  return worker;
}

/** Cache keys inside the app's scope, leaving out the worker's own bookkeeping. */
function scopedKeys(cache: FakeCache | undefined): string[] {
  return [...(cache?.entries.keys() ?? [])].filter((key) => key.startsWith(SCOPE)).sort();
}

describe("service worker install", () => {
  it("precaches every asset, bypassing the HTTP cache, then takes over without waiting", async () => {
    const worker = startWorker();
    await worker.lifecycle("install");
    const cache = worker.storage.caches.get(CACHE_NAME);
    expect(scopedKeys(cache)).toEqual(ASSETS.map((asset) => new URL(asset, SCOPE).href).sort());
    for (const [input] of worker.fetch.mock.calls) expect((input as Request).cache).toBe("reload");
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it("fails the install, and keeps the old worker, when an asset can't be fetched", async () => {
    const worker = startWorker();
    worker.fetch.mockImplementationOnce(async () => basic("gone", { status: 404 }));
    await expect(worker.lifecycle("install")).rejects.toThrow();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });
});

describe("service worker updates", () => {
  const V1 = "111111111111";
  const V2 = "222222222222";
  const V3 = "333333333333";
  const OLD_ASSETS = ["./", "./index.html", "./assets/main-old.js", "./assets/worker-old.js"];
  const NEW_ASSETS = ["./", "./index.html", "./assets/main-new.js", "./assets/worker-new.js"];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T06:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** One phone: the same network and Cache Storage for every version. */
  function phone(removed = new Set<string>()): { fetch: FetchMock; storage: FakeCacheStorage } {
    const fetch = fakeNetwork(removed);
    return { fetch, storage: new FakeCacheStorage((request) => fetch(request)) };
  }

  /** Installs and activates each version in turn, a day apart, as successive deploys would. */
  async function deploy(
    device: { fetch: FetchMock; storage: FakeCacheStorage },
    versions: { version: string; assets: readonly string[] }[],
  ): Promise<Harness> {
    let worker: Harness | null = null;
    for (const { version, assets } of versions) {
      worker = await installed({ version, assets, ...device });
      vi.advanceTimersByTime(DAY_MS);
    }
    return worker!;
  }

  it("claims open pages once active", async () => {
    const worker = startWorker();
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    expect(worker.claim).toHaveBeenCalledOnce();
  });

  it("keeps the previous version's cache, and leaves other apps' caches alone", async () => {
    const device = phone();
    await device.storage.open("another-app-on-this-origin");
    await deploy(device, [
      { version: V1, assets: OLD_ASSETS },
      { version: V2, assets: NEW_ASSETS },
    ]);
    expect(device.storage.names()).toEqual(["another-app-on-this-origin", `duck-call-coach-${V1}`, `duck-call-coach-${V2}`]);
  });

  it("serves a page opened before the update the old files it loads later, after the deploy removed them", async () => {
    const removed = new Set<string>();
    const device = phone(removed);
    const worker = await deploy(device, [
      { version: V1, assets: OLD_ASSETS },
      { version: V2, assets: NEW_ASSETS },
    ]);
    removed.add("/duck-call-coach/assets/worker-old.js");
    const response = await worker.request(new Request(`${SCOPE}assets/worker-old.js`));
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("network /duck-call-coach/assets/worker-old.js");
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("prefers this version's copy of a file both versions have", async () => {
    const device = phone();
    await deploy(device, [{ version: V1, assets: OLD_ASSETS }]);
    await device.storage.caches.get(`duck-call-coach-${V1}`)?.put(`${SCOPE}index.html`, basic("old page"));
    const worker = await deploy(device, [{ version: V2, assets: NEW_ASSETS }]);
    const response = await worker.request(new Request(`${SCOPE}index.html`));
    expect(await response?.text()).toBe("network /duck-call-coach/index.html");
  });

  it("deletes the oldest cache on the third deploy", async () => {
    const device = phone();
    await deploy(device, [
      { version: V1, assets: OLD_ASSETS },
      { version: V2, assets: NEW_ASSETS },
      { version: V3, assets: NEW_ASSETS },
    ]);
    expect(device.storage.names()).toEqual([`duck-call-coach-${V2}`, `duck-call-coach-${V3}`]);
  });

  it("orders versions by install time, not by name", async () => {
    const device = phone();
    // V3 sorts last by name but is installed first.
    await deploy(device, [
      { version: V3, assets: OLD_ASSETS },
      { version: V1, assets: NEW_ASSETS },
      { version: V2, assets: NEW_ASSETS },
    ]);
    expect(device.storage.names()).toEqual([`duck-call-coach-${V1}`, `duck-call-coach-${V2}`]);
  });

  it("drops a half-finished cache from a failed install rather than keep it as the previous version", async () => {
    const device = phone();
    await deploy(device, [{ version: V1, assets: OLD_ASSETS }]);
    await device.storage.open("duck-call-coach-failedinstall");
    await deploy(device, [{ version: V2, assets: NEW_ASSETS }]);
    expect(device.storage.names()).toEqual([`duck-call-coach-${V1}`, `duck-call-coach-${V2}`]);
  });
});

describe("service worker fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets non-GET, cross-origin and out-of-scope requests through untouched", async () => {
    const worker = await installed();
    expect(worker.request(new Request(`${SCOPE}index.html`, { method: "POST", body: "x" }))).toBeUndefined();
    expect(worker.request(new Request("https://cdn.example.com/duck-call-coach/x.js"))).toBeUndefined();
    expect(worker.request(new Request(`${ORIGIN}/another-app/index.html`))).toBeUndefined();
  });

  it("serves pages from the network when it answers, past the HTTP cache's possibly stale copy", async () => {
    const worker = await installed();
    const response = await worker.request(navigation("/duck-call-coach/"));
    expect(await response?.text()).toBe("network /duck-call-coach/");
    expect((worker.fetch.mock.calls[0][0] as Request).cache).toBe("no-cache");
  });

  it("falls back to the cached app page when the network fails", async () => {
    const worker = await installed();
    worker.fetch.mockRejectedValue(new TypeError("offline"));
    const response = await worker.request(navigation("/duck-call-coach/?source=homescreen"));
    expect(await response?.text()).toBe("network /duck-call-coach/index.html");
  });

  it("falls back to the cached app page when the server has an error", async () => {
    const worker = await installed();
    worker.fetch.mockResolvedValueOnce(basic("Service Unavailable", { status: 503 }));
    const response = await worker.request(navigation("/duck-call-coach/"));
    expect(await response?.text()).toBe("network /duck-call-coach/index.html");
  });

  it("shows a page's 404 as it is", async () => {
    const worker = await installed();
    worker.fetch.mockResolvedValueOnce(basic("Page not found", { status: 404 }));
    const response = await worker.request(navigation("/duck-call-coach/nothing-here"));
    expect(response?.status).toBe(404);
  });

  it("falls back to the cached diagnostics page for that page", async () => {
    const worker = await installed();
    worker.fetch.mockRejectedValue(new TypeError("offline"));
    const response = await worker.request(navigation("/duck-call-coach/diagnostics.html"));
    expect(await response?.text()).toBe("network /duck-call-coach/diagnostics.html");
  });

  it("falls back to the cache after 3 s when the network hangs (one bar of signal)", async () => {
    const worker = await installed();
    worker.fetch.mockReturnValue(new Promise<Response>(() => undefined));
    const response = worker.request(navigation("/duck-call-coach/"));
    let settled = false;
    void response?.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await (await response)?.text()).toBe("network /duck-call-coach/index.html");
  });

  it("serves other files from the cache without touching the network", async () => {
    const worker = await installed();
    const response = await worker.request(new Request(`${SCOPE}assets/main-a.js`));
    expect(await response?.text()).toBe("network /duck-call-coach/assets/main-a.js");
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("serves a precached file to a module script request, whatever the server's Vary header says", async () => {
    // <script type="module" crossorigin> sends Origin; the precache request didn't, and some servers vary on it.
    const worker = await installed();
    const response = await worker.request(new Request(`${SCOPE}assets/varied.js`, { headers: { Origin: ORIGIN } }));
    expect(await response?.text()).toBe("network /duck-call-coach/assets/varied.js");
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("fetches and keeps a file missing from the cache", async () => {
    const worker = await installed();
    await worker.request(new Request(`${SCOPE}assets/late-b.js`));
    await worker.idle();
    const again = await worker.request(new Request(`${SCOPE}assets/late-b.js`));
    expect(await again?.text()).toBe("network /duck-call-coach/assets/late-b.js");
    expect(worker.fetch).toHaveBeenCalledOnce();
  });

  it("answers a cache miss without waiting for the cache write", async () => {
    const worker = await installed();
    const cache = worker.storage.caches.get(CACHE_NAME)!;
    let release = (): void => undefined;
    cache.holdPuts = new Promise<void>((resolve) => (release = resolve));
    const response = await worker.request(new Request(`${SCOPE}assets/late-c.js`));
    expect(await response?.text()).toBe("network /duck-call-coach/assets/late-c.js");
    expect(cache.entries.has(`${SCOPE}assets/late-c.js`)).toBe(false);
    release();
    await worker.idle();
    expect(cache.entries.has(`${SCOPE}assets/late-c.js`)).toBe(true);
  });

  it("does not keep failed or non-basic responses", async () => {
    const worker = await installed();
    const missing = await worker.request(new Request(`${SCOPE}assets/missing.js`));
    expect(missing?.status).toBe(404);
    worker.fetch.mockResolvedValueOnce(basic("opaque", {}, "opaque"));
    await worker.request(new Request(`${SCOPE}assets/odd.js`));
    await worker.idle();
    const cache = worker.storage.caches.get(CACHE_NAME);
    expect(cache?.entries.has(`${SCOPE}assets/missing.js`)).toBe(false);
    expect(cache?.entries.has(`${SCOPE}assets/odd.js`)).toBe(false);
  });

  it("answers a byte-range request for a cached clip with just those bytes", async () => {
    const worker = await installed();
    const response = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=2-5" } }));
    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response?.headers.get("Content-Length")).toBe("4");
    expect(response?.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(new Uint8Array([12, 13, 14, 15]));
  });

  it("handles open-ended and suffix ranges", async () => {
    const worker = await installed();
    const open = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=0-" } }));
    expect(open?.headers.get("Content-Range")).toBe("bytes 0-9/10");
    expect(new Uint8Array(await open!.arrayBuffer())).toEqual(CLIP);
    const suffix = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=-3" } }));
    expect(suffix?.headers.get("Content-Range")).toBe("bytes 7-9/10");
    const clamped = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=8-99" } }));
    expect(clamped?.headers.get("Content-Range")).toBe("bytes 8-9/10");
  });

  it("refuses a range past the end and ignores one it can't read", async () => {
    const worker = await installed();
    const past = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=10-" } }));
    expect(past?.status).toBe(416);
    expect(past?.headers.get("Content-Range")).toBe("bytes */10");
    const multi = await worker.request(new Request(`${SCOPE}clips/hail.mp3`, { headers: { Range: "bytes=0-1,4-5" } }));
    expect(multi?.status).toBe(200);
    expect(new Uint8Array(await multi!.arrayBuffer())).toEqual(CLIP);
  });
});
