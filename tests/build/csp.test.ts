import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../../src/build/csp";

function directives(): Map<string, string> {
  return new Map(
    CONTENT_SECURITY_POLICY.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name ?? "", sources.join(" ")];
    }),
  );
}

describe("Content Security Policy", () => {
  it("allows only this site, plus blob: for playing recordings", () => {
    expect(Object.fromEntries(directives())).toEqual({
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self'",
      "img-src": "'self'",
      "media-src": "'self' blob:",
      "worker-src": "'self'",
      "connect-src": "'self'",
      "object-src": "'none'",
      "base-uri": "'self'",
      "form-action": "'none'",
    });
  });
});
