/**
 * Builds DOM without ever parsing HTML: strings become text nodes, so user-supplied text (reference names,
 * file names, backup contents) can be passed straight in.
 */

/** Inline handlers and inline styles are blocked by the production CSP, so refuse them here too. */
function assertAllowedAttribute(name: string): void {
  if (/^on/i.test(name) || name.toLowerCase() === "style") {
    throw new Error(`el(): the "${name}" attribute is not allowed; use addEventListener or a CSS class`);
  }
}

/** `el("p", { class: "muted" }, "Hello ", el("strong", {}, name))`. Props are set as attributes. */
export function el(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    assertAllowedAttribute(name);
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** A real <button type="button"> with a text label. */
export function button(label: string, props: Record<string, string> = {}): HTMLButtonElement {
  return el("button", { type: "button", ...props }, label) as HTMLButtonElement;
}
