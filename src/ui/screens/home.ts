import type { CallType } from "../../analysis/types";
import { loadTargets } from "../../scoring/score";
import { getDefaultStore, storageEstimate } from "../../storage/db";
import { el } from "../dom";
import { getInstallController } from "../install";
import { installOfferSection } from "../installOffer";
import { CALL_NAMES, confidenceText, HOME_CALL_ORDER } from "../labels";
import { routeHref, type Route } from "../router";
import { summarizeScores, summaryLines } from "../scoreSummary";
import { showStorageWarning, storageWarningBanner } from "../storageUse";
import type { RenderScreen } from "./screen";

/** History and References are per call type; links from Home open them on the first call. */
const DEFAULT_CALL: CallType = HOME_CALL_ORDER[0];

function tile(callType: CallType): { item: HTMLElement; scores: HTMLElement } {
  const scores = el("span", { class: "tile-scores" }, "Loading scores…");
  const link = el(
    "a",
    { class: "tile", href: routeHref({ name: "practice", callType }) },
    el("span", { class: "tile-name" }, CALL_NAMES[callType]),
    scores,
    el("span", { class: "tile-confidence" }, confidenceText(loadTargets(callType).confidence)),
  );
  return { item: el("li", {}, link), scores };
}

function navLink(label: string, route: Route): HTMLElement {
  return el("li", {}, el("a", { class: "nav-link", href: routeHref(route) }, label));
}

function showScores(target: HTMLElement, lines: string[]): void {
  target.replaceChildren(...lines.map((line) => el("span", { class: "tile-score-line" }, line)));
}

async function fillScores(tiles: Map<CallType, HTMLElement>, isDisposed: () => boolean): Promise<void> {
  try {
    const store = await getDefaultStore();
    const lists = await Promise.all(HOME_CALL_ORDER.map((callType) => store.listAttempts(callType)));
    if (isDisposed()) return;
    HOME_CALL_ORDER.forEach((callType, i) => {
      const target = tiles.get(callType);
      if (target) showScores(target, summaryLines(summarizeScores(lists[i])));
    });
  } catch {
    if (isDisposed()) return;
    for (const target of tiles.values()) showScores(target, ["Scores unavailable"]);
  }
}

export const renderHome: RenderScreen = (root) => {
  let disposed = false;
  const tiles = new Map<CallType, HTMLElement>();
  const list = el("ul", { class: "tiles" });
  for (const callType of HOME_CALL_ORDER) {
    const { item, scores } = tile(callType);
    tiles.set(callType, scores);
    list.append(item);
  }

  const banner = storageWarningBanner();
  const install = installOfferSection(getInstallController());
  root.append(
    el("h1", { tabindex: "-1" }, "Duck Call Coach"),
    banner,
    el("p", { class: "lead" }, "Pick a call to practice. You'll get a score and tips after each try."),
    install.element,
    list,
    el(
      "nav",
      { "aria-label": "More" },
      el(
        "ul",
        { class: "nav-links" },
        navLink("History", { name: "history", callType: DEFAULT_CALL }),
        navLink("References", { name: "references", callType: DEFAULT_CALL }),
        navLink("Back up / Restore", { name: "history", callType: DEFAULT_CALL }),
        navLink("Credits", { name: "credits" }),
      ),
    ),
  );

  void fillScores(tiles, () => disposed);
  // storageEstimate never rejects; it gives null when the browser can't say.
  void storageEstimate().then((estimate) => {
    if (!disposed) showStorageWarning(banner, estimate);
  });
  return () => {
    disposed = true;
    install.dispose();
  };
};
