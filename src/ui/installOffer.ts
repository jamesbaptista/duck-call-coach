import { button, el } from "./dom";
import type { InstallController } from "./install";

export const INSTALL_OFFER_TEXT = "Add Duck Call Coach to your home screen. It opens like an app and works with no signal.";
export const IOS_INSTALL_HINT = "To install, tap Share → Add to Home Screen.";

function installButtons(controller: InstallController): HTMLElement[] {
  const add = button("Add to Home Screen", { class: "button primary" });
  const notNow = button("Not now", { class: "button secondary" });
  add.addEventListener("click", () => void controller.install());
  notNow.addEventListener("click", () => void controller.dismiss());
  return [el("p", {}, INSTALL_OFFER_TEXT), add, notNow];
}

/** The install offer on Home: kept in step with the controller until `dispose`. */
export function installOfferSection(controller: InstallController): { element: HTMLElement; dispose: () => void } {
  const element = el("section", { class: "install-offer", "aria-label": "Install the app" });
  let shown = controller.offer();

  const render = (): void => {
    shown = controller.offer();
    element.hidden = shown === "none";
    if (shown === "button") {
      element.replaceChildren(...installButtons(controller));
    } else if (shown === "ios-hint") {
      element.replaceChildren(el("p", {}, IOS_INSTALL_HINT));
      void controller.markHintShown();
    } else {
      element.replaceChildren();
    }
  };

  render();
  const unsubscribe = controller.subscribe(() => {
    // Rebuild only on a real change, so a focused button isn't replaced under the user's finger.
    if (controller.offer() !== shown) render();
  });
  return { element, dispose: unsubscribe };
}
