import { afterEach, describe, expect, it, vi } from "vitest";
import { checkImportDuration, checkImportFile, knownDuration, probeDurationS } from "../../src/ui/importAudio";

const MB = 1024 * 1024;
const TOO_BIG = "That file is over 20 MB.";
const NOT_AUDIO = "That isn't an audio file.";
const TOO_LONG = "That recording is too long. Use a clip under 10 minutes.";

function file(size: number, type: string, name = "hen.mp3"): { size: number; type: string; name: string } {
  return { size, type, name };
}

describe("checkImportFile", () => {
  it("refuses a file over 20 MB", () => {
    expect(checkImportFile(file(21 * MB, "audio/mpeg"))).toBe(TOO_BIG);
  });

  it("refuses a file that isn't audio", () => {
    expect(checkImportFile(file(1000, "text/plain", "notes.txt"))).toBe(NOT_AUDIO);
  });

  it("accepts a 2 MB MP3", () => {
    expect(checkImportFile(file(2 * MB, "audio/mpeg"))).toBeNull();
  });

  it("accepts a file of exactly 20 MB, the most a backup can hold", () => {
    expect(checkImportFile(file(20 * MB, "audio/mpeg"))).toBeNull();
    expect(checkImportFile(file(20 * MB + 1, "audio/mpeg"))).toBe(TOO_BIG);
  });

  it("accepts audio types with parameters, as recordings have", () => {
    expect(checkImportFile(file(1000, "audio/webm;codecs=opus"))).toBeNull();
    expect(checkImportFile(file(1000, "audio/x-m4a"))).toBeNull();
  });

  it("refuses a file whose type the phone doesn't know, or that only looks like audio", () => {
    expect(checkImportFile(file(1000, ""))).toBe(NOT_AUDIO);
    expect(checkImportFile(file(1000, "video/mp4"))).toBe(NOT_AUDIO);
    expect(checkImportFile(file(1000, "audio/"))).toBe(NOT_AUDIO);
    expect(checkImportFile(file(1000, "xaudio/mpeg"))).toBe(NOT_AUDIO);
  });

  it("refuses an audio type too long for a backup to restore", () => {
    expect(checkImportFile(file(1000, `audio/mpeg;${"x".repeat(100)}`))).toBe(NOT_AUDIO);
  });

  it("checks the size first", () => {
    expect(checkImportFile(file(21 * MB, "text/plain"))).toBe(TOO_BIG);
  });
});

describe("checkImportDuration", () => {
  it("refuses a recording over 10 minutes", () => {
    expect(checkImportDuration(600.5)).toBe(TOO_LONG);
    expect(checkImportDuration(3600)).toBe(TOO_LONG);
  });

  it("accepts up to exactly 10 minutes", () => {
    expect(checkImportDuration(600)).toBeNull();
    expect(checkImportDuration(4.2)).toBeNull();
  });

  it("lets a file of unknown length through to decoding", () => {
    expect(checkImportDuration(null)).toBeNull();
  });
});

describe("knownDuration", () => {
  it("keeps a finite duration", () => {
    expect(knownDuration(12.5)).toBe(12.5);
    expect(knownDuration(0)).toBe(0);
  });

  it("treats NaN, Infinity (some WebM recordings) and negatives as unknown", () => {
    expect(knownDuration(Number.NaN)).toBeNull();
    expect(knownDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(knownDuration(-1)).toBeNull();
  });
});

/** Just enough of an <audio> element for probeDurationS. */
class FakeAudio extends EventTarget {
  preload = "";
  src = "";
  duration = Number.NaN;
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  load(): void {}
}

describe("probeDurationS", () => {
  let audio: FakeAudio;
  const revoked: string[] = [];

  function stubDom(): void {
    audio = new FakeAudio();
    revoked.length = 0;
    vi.stubGlobal("document", { createElement: (tag: string) => (tag === "audio" ? audio : undefined) });
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:probe",
      revokeObjectURL: (url: string) => revoked.push(url),
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads the duration from the metadata only, then frees the object URL", async () => {
    stubDom();
    const probe = probeDurationS(new Blob(["x"]));
    expect(audio.preload).toBe("metadata");
    expect(audio.src).toBe("blob:probe");
    audio.duration = 720;
    audio.dispatchEvent(new Event("loadedmetadata"));
    await expect(probe).resolves.toBe(720);
    expect(revoked).toEqual(["blob:probe"]);
    expect(audio.src).toBe("");
  });

  it("reports an unknown length when the browser can't read the file", async () => {
    stubDom();
    const probe = probeDurationS(new Blob(["x"]));
    audio.dispatchEvent(new Event("error"));
    await expect(probe).resolves.toBeNull();
    expect(revoked).toEqual(["blob:probe"]);
  });

  it("gives up after the timeout and reports an unknown length", async () => {
    vi.useFakeTimers();
    stubDom();
    const probe = probeDurationS(new Blob(["x"]), 5000);
    vi.advanceTimersByTime(4999);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    await expect(probe).resolves.toBeNull();
    expect(revoked).toEqual(["blob:probe"]);
  });

  it("settles once, even if a late event follows", async () => {
    stubDom();
    const probe = probeDurationS(new Blob(["x"]));
    audio.duration = 30;
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.dispatchEvent(new Event("error"));
    await expect(probe).resolves.toBe(30);
    expect(revoked).toEqual(["blob:probe"]);
  });
});
