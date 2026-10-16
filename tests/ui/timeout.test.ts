import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTimeout, withTimeout } from "../../src/ui/timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise's value when it settles in time", async () => {
    const result = withTimeout(Promise.resolve(42), 1000);
    await expect(result).resolves.toBe(42);
  });

  it("rejects with the promise's own error when it fails in time", async () => {
    const failure = new Error("worker crashed");
    await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(failure);
  });

  it("rejects with a TimeoutError once the time is up", async () => {
    const never = new Promise<number>(() => undefined);
    const result = withTimeout(never, 30_000);
    const settled = vi.fn();
    result.then(settled, settled);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toMatchObject({ name: "TimeoutError", message: "It took longer than 30 s." });
  });

  it("ignores a late result after timing out", async () => {
    let resolveLate: (value: number) => void = () => undefined;
    const late = new Promise<number>((resolve) => {
      resolveLate = resolve;
    });
    const outcome = expect(withTimeout(late, 500)).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(500);
    resolveLate(7);
    await outcome;
  });

  it("clears its timer once the promise settles", async () => {
    await withTimeout(Promise.resolve("done"), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tells its own timeout apart from other failures", async () => {
    const outcome = withTimeout(new Promise<never>(() => undefined), 10).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(isTimeout(await outcome)).toBe(true);
    expect(isTimeout(new Error("worker crashed"))).toBe(false);
    expect(isTimeout("TimeoutError")).toBe(false);
    expect(isTimeout(null)).toBe(false);
  });
});
