import { el } from "../dom";
import { routeHref, type Route } from "../router";
import type { RenderScreen } from "./screen";

const TITLES: Record<Route["name"], string> = {
  home: "Home",
  practice: "Practice",
  results: "Results",
  history: "History",
  references: "References",
  credits: "Credits",
};

/** Stands in for screens that later tasks build (Results, History, References, Credits). */
export const renderPlaceholder: RenderScreen = (root, route) => {
  root.append(
    el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
    el("h1", { tabindex: "-1" }, TITLES[route.name]),
    el("p", { class: "lead" }, "This screen isn't ready yet."),
  );
  return () => undefined;
};
