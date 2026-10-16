import { describe, expect, it } from "vitest";
import {
  activeTargetText,
  defaultReferenceName,
  deleteReferenceQuestion,
  nameFromFileName,
  normalizeReferenceName,
} from "../../src/ui/screens/references/model";

const UTC_DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

describe("normalizeReferenceName", () => {
  it("trims the name", () => {
    expect(normalizeReferenceName("  Morning hail \n")).toBe("Morning hail");
  });

  it("gives null for a name that is empty or only spaces", () => {
    expect(normalizeReferenceName("")).toBeNull();
    expect(normalizeReferenceName("   \t ")).toBeNull();
  });

  it("cuts a name to 60 characters, then trims again", () => {
    expect(normalizeReferenceName("a".repeat(70))).toBe("a".repeat(60));
    expect(normalizeReferenceName(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });

  it("never cuts an emoji in half", () => {
    const name = normalizeReferenceName(`${"a".repeat(59)}🦆`);
    expect(name).toBe("a".repeat(59));
    expect(normalizeReferenceName(`${"a".repeat(58)}🦆`)).toBe(`${"a".repeat(58)}🦆`);
  });
});

describe("nameFromFileName", () => {
  it("drops the extension", () => {
    expect(nameFromFileName("Hen hail.mp3")).toBe("Hen hail");
    expect(nameFromFileName("marsh.2026.10.wav")).toBe("marsh.2026.10");
  });

  it("keeps a name with no extension", () => {
    expect(nameFromFileName("hail")).toBe("hail");
  });

  it("trims and cuts to 60 characters", () => {
    expect(nameFromFileName("  dawn hail  .m4a")).toBe("dawn hail");
    expect(nameFromFileName(`${"b".repeat(80)}.mp3`)).toBe("b".repeat(60));
  });

  it("gives an empty name when only an extension is left", () => {
    expect(nameFromFileName(".mp3")).toBe("");
    expect(nameFromFileName("   .mp3")).toBe("");
  });
});

describe("defaultReferenceName", () => {
  it("is 'My reference' and the day", () => {
    expect(defaultReferenceName(Date.UTC(2026, 9, 16, 6, 30), UTC_DAY)).toBe("My reference Oct 16, 2026");
  });
});

describe("activeTargetText", () => {
  it("says the built-in target is used when no reference is active", () => {
    expect(activeTargetText([])).toBe("Using the built-in target.");
    expect(activeTargetText([{ name: "Old", active: false }])).toBe("Using the built-in target.");
  });

  it("names the active reference", () => {
    expect(activeTargetText([{ name: "Old", active: false }, { name: "Dawn hail", active: true }])).toBe(
      "Using your reference “Dawn hail”.",
    );
  });
});

describe("deleteReferenceQuestion", () => {
  it("names the reference", () => {
    expect(deleteReferenceQuestion("Dawn hail")).toBe("Delete the reference “Dawn hail”? This can't be undone.");
  });
});
