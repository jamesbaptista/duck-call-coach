import { describe, expect, it, vi } from "vitest";
import { ensurePersistence, PERSIST_SETTING, shouldRequestPersistence } from "../../src/ui/persistence";

function fakeSettings(saved: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(saved));
  return {
    values,
    getSetting: vi.fn(async (key: string) => values.get(key)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
}

describe("shouldRequestPersistence", () => {
  it("asks on the first run", () => {
    expect(shouldRequestPersistence(undefined, "browser")).toBe(true);
    expect(shouldRequestPersistence(undefined, "installed")).toBe(true);
  });

  it("does not ask again in the same kind of window", () => {
    expect(shouldRequestPersistence(["browser"], "browser")).toBe(false);
    expect(shouldRequestPersistence(["installed"], "installed")).toBe(false);
  });

  it("asks once more after the app is installed, which is when Chrome normally grants it", () => {
    expect(shouldRequestPersistence(["browser"], "installed")).toBe(true);
  });

  it("treats an unreadable saved value as not asked", () => {
    expect(shouldRequestPersistence("yes", "browser")).toBe(true);
    expect(shouldRequestPersistence({ browser: true }, "browser")).toBe(true);
  });
});

describe("ensurePersistence", () => {
  it("asks on the first run and remembers it", async () => {
    const settings = fakeSettings();
    const request = vi.fn(async () => false);
    await ensurePersistence(settings, "browser", request);
    expect(request).toHaveBeenCalledOnce();
    expect(settings.values.get(PERSIST_SETTING)).toEqual(["browser"]);
  });

  it("does not ask on later launches", async () => {
    const settings = fakeSettings({ [PERSIST_SETTING]: ["browser"] });
    const request = vi.fn(async () => true);
    await ensurePersistence(settings, "browser", request);
    expect(request).not.toHaveBeenCalled();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it("adds the installed app to what it remembers", async () => {
    const settings = fakeSettings({ [PERSIST_SETTING]: ["browser"] });
    const request = vi.fn(async () => true);
    await ensurePersistence(settings, "installed", request);
    expect(request).toHaveBeenCalledOnce();
    expect(settings.values.get(PERSIST_SETTING)).toEqual(["browser", "installed"]);
  });

  it("never rejects when settings can't be read or saved", async () => {
    const request = vi.fn(async () => false);
    const broken = {
      getSetting: vi.fn(() => Promise.reject(new Error("IndexedDB unavailable"))),
      setSetting: vi.fn(() => Promise.reject(new Error("IndexedDB unavailable"))),
    };
    await expect(ensurePersistence(broken, "browser", request)).resolves.toBeUndefined();
  });
});
