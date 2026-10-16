import type { CallType } from "../analysis/types";
import { el } from "./dom";
import { CALL_NAMES, HOME_CALL_ORDER } from "./labels";
import { routeHref } from "./router";

/** Four links, one per call; each opens the same screen (History or References) for that call, and the current one is marked. */
export function callSwitcher(screen: "history" | "references", current: CallType): HTMLElement {
  const links = HOME_CALL_ORDER.map((callType) => {
    const props: Record<string, string> = { class: "switch-link", href: routeHref({ name: screen, callType }) };
    if (callType === current) props["aria-current"] = "page";
    return el("li", {}, el("a", props, CALL_NAMES[callType]));
  });
  return el("nav", { "aria-label": "Choose a call" }, el("ul", { class: "call-switcher" }, ...links));
}
