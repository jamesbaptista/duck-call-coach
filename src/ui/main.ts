import "./styles.css";
import { getDefaultStore } from "../storage/db";
import { el } from "./dom";
import { getInstallController, runningStandalone } from "./install";
import { ensurePersistence } from "./persistence";
import { parseRoute, type Route } from "./router";
import { renderCredits } from "./screens/credits";
import { renderHistory } from "./screens/history";
import { renderHome } from "./screens/home";
import { renderPractice } from "./screens/practice";
import { renderReferences } from "./screens/references";
import { renderResults } from "./screens/results";
import type { Cleanup } from "./screens/screen";

function renderRoute(root: HTMLElement, route: Route): Cleanup {
  switch (route.name) {
    case "home":
      return renderHome(root, route);
    case "practice":
      return renderPractice(root, route);
    case "results":
      return renderResults(root, route);
    case "history":
      return renderHistory(root, route);
    case "references":
      return renderReferences(root, route);
    case "credits":
      return renderCredits(root, route);
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

/** Production only: the service worker that makes the app work offline exists only in a build. */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  // After load, so caching the app doesn't compete with showing it.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error: unknown) => {
      console.warn("Offline support is unavailable:", error);
    });
  });
}

registerServiceWorker();
// Before the first render, so an early install prompt isn't missed.
void getInstallController().start(window);
void getDefaultStore()
  .then((store) => ensurePersistence(store, runningStandalone() ? "installed" : "browser"))
  .catch(() => undefined);

const root = document.getElementById("app");
if (root) start(root);
