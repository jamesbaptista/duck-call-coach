import type { Route } from "../router";

/** Undoes everything a screen started: recordings, playback, object URLs, animation frames, listeners. */
export type Cleanup = () => void;

/** Every screen renders into the (already empty) app root and returns its cleanup. */
export type RenderScreen<R = Route> = (root: HTMLElement, route: R) => Cleanup;
