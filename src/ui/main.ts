import "./styles.css";
import { el } from "./dom";
import { parseRoute, type Route } from "./router";
import { renderHome } from "./screens/home";
import { renderPlaceholder } from "./screens/placeholder";
import { renderPractice } from "./screens/practice";
import type { Cleanup } from "./screens/screen";

function renderRoute(root: HTMLElement, route: Route): Cleanup {
  switch (route.name) {
    case "home":
      return renderHome(root, route);
    case "practice":
      return renderPractice(root, route);
    default:
      return renderPlaceholder(root, route);
  }
}

/** Moves focus to the new screen's heading so screen readers announce the change. */
function focusHeading(root: HTMLElement): void {
  root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

function start(root: HTMLElement): void {
  let cleanup: Cleanup | null = null;

  const show = (): void => {
    cleanup?.();
    cleanup = null;
    root.replaceChildren();
    try {
      cleanup = renderRoute(root, parseRoute(location.hash));
    } catch (error) {
      root.replaceChildren(
        el("h1", { tabindex: "-1" }, "Something went wrong"),
        el("p", {}, "This screen couldn't be shown. Reload the page to try again."),
        el("p", { class: "status-detail" }, error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
      );
    }
    window.scrollTo(0, 0);
    focusHeading(root);
  };

  window.addEventListener("hashchange", show);
  show();
}

const root = document.getElementById("app");
if (root) start(root);
