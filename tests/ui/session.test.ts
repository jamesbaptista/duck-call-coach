import { describe, expect, it } from "vitest";
import { forgetUnsavedAttempt, getUnsavedAttempt, rememberUnsavedAttempt } from "../../src/ui/session";
import { attempt } from "../helpers/records";

describe("unsaved attempts", () => {
  it("keeps an attempt by id until it is forgotten", () => {
    const record = attempt("unsaved-1", "hail", 1);
    rememberUnsavedAttempt(record);
    expect(getUnsavedAttempt("unsaved-1")).toBe(record);
    forgetUnsavedAttempt("unsaved-1");
    expect(getUnsavedAttempt("unsaved-1")).toBeUndefined();
  });

  it("keeps only the three most recent, since each holds a recording", () => {
    for (const id of ["a", "b", "c", "d"]) rememberUnsavedAttempt(attempt(id, "quack", 1));
    expect(getUnsavedAttempt("a")).toBeUndefined();
    expect(["b", "c", "d"].map((id) => getUnsavedAttempt(id)?.id)).toEqual(["b", "c", "d"]);
  });
});
