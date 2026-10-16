import type { CallType } from "../analysis/types";
import { CALL_TYPES } from "../scoring/types";

export type Route =
  | { name: "home" }
  | { name: "practice" | "history" | "references"; callType: CallType }
  | { name: "results"; id: string }
  | { name: "credits" };

const HOME: Route = { name: "home" };
const CALL_TYPE_SCREENS = ["practice", "history", "references"] as const;
/** Attempt ids are limited to characters that need no escaping in a URL (backup restore enforces the same rule). */
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isCallType(value: string): value is CallType {
  return (CALL_TYPES as readonly string[]).includes(value);
}

function isCallTypeScreen(value: string): value is (typeof CALL_TYPE_SCREENS)[number] {
  return (CALL_TYPE_SCREENS as readonly string[]).includes(value);
}

/** Reads a location hash such as "#/practice/hail". Anything unrecognised goes home. */
export function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#/, "").split("/").filter((segment) => segment !== "");
  const [screen = "", param, ...extra] = segments;
  if (extra.length > 0) return HOME;
  if (param === undefined) return screen === "credits" ? { name: "credits" } : HOME;
  if (isCallTypeScreen(screen)) return isCallType(param) ? { name: screen, callType: param } : HOME;
  if (screen === "results" && VALID_ID.test(param)) return { name: "results", id: param };
  return HOME;
}

/** The hash link for a route; `parseRoute(routeHref(r))` gives `r` back. */
export function routeHref(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "credits":
      return "#/credits";
    case "results":
      return `#/results/${route.id}`;
    default:
      return `#/${route.name}/${route.callType}`;
  }
}

/** Moves to a route; the app shell renders it on the resulting hashchange. */
export function navigate(route: Route): void {
  location.hash = routeHref(route);
}
