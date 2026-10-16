import { requestPersistence } from "../storage/db";
import type { SettingsStore } from "./settings";

/**
 * Asking the browser to keep our data (navigator.storage.persist). Chrome grants it silently, and usually only
 * once the app is installed, so it is asked once in a browser tab and once more in the installed app, never on
 * every launch.
 */

export const PERSIST_SETTING = "persistRequested";

export type AppWindow = "browser" | "installed";

const APP_WINDOWS: readonly AppWindow[] = ["browser", "installed"];

/** The kinds of window persistence was already asked in, read from the saved setting. */
function askedIn(saved: unknown): AppWindow[] {
  if (!Array.isArray(saved)) return [];
  return APP_WINDOWS.filter((appWindow) => saved.includes(appWindow));
}

export function shouldRequestPersistence(saved: unknown, appWindow: AppWindow): boolean {
  return !askedIn(saved).includes(appWindow);
}

/** Asks for persistent storage if it hasn't been asked in this kind of window yet. Never rejects. */
export async function ensurePersistence(
  settings: SettingsStore,
  appWindow: AppWindow,
  request: () => Promise<boolean> = requestPersistence,
): Promise<void> {
  try {
    const saved = await settings.getSetting(PERSIST_SETTING);
    if (!shouldRequestPersistence(saved, appWindow)) return;
    await request();
    await settings.setSetting(PERSIST_SETTING, [...askedIn(saved), appWindow]);
  } catch {
    // The app works without persistent storage; the next launch tries again.
  }
}
