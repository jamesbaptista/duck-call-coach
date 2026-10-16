import { describe, expect, it } from "vitest";
import { checkImportFile } from "../../src/ui/importAudio";

const MB = 1024 * 1024;
const TOO_BIG = "That file is over 20 MB.";
const NOT_AUDIO = "That isn't an audio file.";

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
