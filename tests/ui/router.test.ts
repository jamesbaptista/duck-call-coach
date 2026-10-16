import { describe, expect, it } from "vitest";
import { parseRoute, routeHref, type Route } from "../../src/ui/router";

describe("parseRoute", () => {
  it("reads a practice route", () => {
    expect(parseRoute("#/practice/hail")).toEqual({ name: "practice", callType: "hail" });
  });

  it("sends an unknown call type home", () => {
    expect(parseRoute("#/practice/goose")).toEqual({ name: "home" });
  });

  it("sends an empty hash home", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
  });

  it("reads history, references, results and credits routes", () => {
    expect(parseRoute("#/history/chuckle")).toEqual({ name: "history", callType: "chuckle" });
    expect(parseRoute("#/references/comeback")).toEqual({ name: "references", callType: "comeback" });
    expect(parseRoute("#/results/abc-123_X")).toEqual({ name: "results", id: "abc-123_X" });
    expect(parseRoute("#/credits")).toEqual({ name: "credits" });
  });

  it("sends malformed routes home", () => {
    for (const hash of [
      "#/unknown",
      "#/practice",
      "#/practice/hail/extra",
      "#/credits/extra",
      "#/results",
      "#/results/has%20space",
      "#/results/" + "a".repeat(65),
      "#/results/<script>",
      "#/Practice/hail",
      "#/constructor/hail",
      "#/__proto__",
    ]) {
      expect(parseRoute(hash), hash).toEqual({ name: "home" });
    }
  });
});

describe("routeHref", () => {
  const routes: Route[] = [
    { name: "home" },
    { name: "credits" },
    { name: "results", id: "0f8c1a2e-1111-4a2b-9c3d-abcdefabcdef" },
    ...(["quack", "hail", "comeback", "chuckle"] as const).flatMap((callType): Route[] => [
      { name: "practice", callType },
      { name: "history", callType },
      { name: "references", callType },
    ]),
  ];

  it("round-trips every route through parseRoute", () => {
    for (const route of routes) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it("writes hash links", () => {
    expect(routeHref({ name: "home" })).toBe("#/");
    expect(routeHref({ name: "practice", callType: "hail" })).toBe("#/practice/hail");
  });
});
