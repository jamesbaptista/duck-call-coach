import { getDefaultStore } from "../storage/db";
import type { SettingsStore } from "./settings";

/**
 * Offering to add the app to the home screen. Android Chrome fires `beforeinstallprompt`, which is held back and
 * replaced by an "Add to Home Screen" button on Home. Safari on iPhone has no such event, so it gets a one-line
 * hint, on one launch only.
 */

export const INSTALL_DISMISSED_SETTING = "installPromptDismissed";
export const IOS_HINT_SHOWN_SETTING = "iosInstallHintShown";

export type InstallOffer = "button" | "ios-hint" | "none";

export interface InstallState {
  /** Saved choices have been read (or failed to read); until then nothing is offered. */
  settingsLoaded: boolean;
  /** Already running as the installed app. */
  standalone: boolean;
  /** Android: the browser's install prompt is ready to show. */
  promptReady: boolean;
  /** The user said Not now, or turned down the browser's prompt. */
  dismissed: boolean;
  iosSafari: boolean;
  /** The iPhone hint was shown on an earlier launch. */
  iosHintShownBefore: boolean;
}

export function installOffer(state: InstallState): InstallOffer {
  if (!state.settingsLoaded || state.standalone) return "none";
  if (state.promptReady) return state.dismissed ? "none" : "button";
  if (state.iosSafari && !state.iosHintShownBefore) return "ios-hint";
  return "none";
}

/** Safari on iPhone or iPad, where Share → Add to Home Screen installs the app. Not other browsers or in-app views. */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const iPhoneOrIPad = /iPhone|iPad|iPod/.test(userAgent);
  // iPadOS asks for desktop sites as a Mac; only the touch screen gives it away.
  const iPadAsMac = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (!iPhoneOrIPad && !iPadAsMac) return false;
  return /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent);
}

/** True in the installed app (Android) or a home-screen web app (iPhone). */
export function runningStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

/** Chrome's install prompt event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallDependencies {
  settings: () => Promise<SettingsStore>;
  standalone: () => boolean;
  iosSafari: boolean;
}

export class InstallController {
  private prompt: BeforeInstallPromptEvent | null = null;
  private settingsLoaded = false;
  private dismissed = false;
  private iosHintShownBefore = false;
  private hintMarked = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: InstallDependencies) {}

  /** Call once at startup, before the browser can fire its prompt. Resolves once saved choices are read. */
  async start(target: EventTarget): Promise<void> {
    target.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.prompt = event as BeforeInstallPromptEvent;
      this.changed();
    });
    target.addEventListener("appinstalled", () => {
      this.prompt = null;
      this.changed();
    });
    await this.loadSettings();
  }

  offer(): InstallOffer {
    return installOffer({
      settingsLoaded: this.settingsLoaded,
      standalone: this.deps.standalone(),
      promptReady: this.prompt !== null,
      dismissed: this.dismissed,
      iosSafari: this.deps.iosSafari,
      iosHintShownBefore: this.iosHintShownBefore,
    });
  }

  /** `listener` runs whenever `offer()` may have changed. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Shows the browser's install prompt (call from a tap). Turning it down counts as Not now. */
  async install(): Promise<void> {
    const prompt = this.prompt;
    if (prompt === null) return;
    // A prompt can be shown only once.
    this.prompt = null;
    this.changed();
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "dismissed") await this.dismiss();
    } catch {
      // The browser refused to show it; Chrome offers install from its own menu too.
    }
  }

  /** Not now: stop offering the button, on this and later launches. */
  async dismiss(): Promise<void> {
    this.dismissed = true;
    this.changed();
    await this.save(INSTALL_DISMISSED_SETTING);
  }

  /** The iPhone hint is on screen: keep it for this launch, but don't show it on later ones. */
  async markHintShown(): Promise<void> {
    if (this.hintMarked) return;
    this.hintMarked = true;
    await this.save(IOS_HINT_SHOWN_SETTING);
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.deps.settings();
      const [dismissed, hintShown] = await Promise.all([
        settings.getSetting(INSTALL_DISMISSED_SETTING),
        settings.getSetting(IOS_HINT_SHOWN_SETTING),
      ]);
      this.dismissed ||= dismissed === true;
      this.iosHintShownBefore = hintShown === true;
    } catch {
      // Without saved choices, offer install as on a first run.
    }
    this.settingsLoaded = true;
    this.changed();
  }

  private async save(key: string): Promise<void> {
    try {
      await (await this.deps.settings()).setSetting(key, true);
    } catch {
      // Not saved: the offer comes back on the next launch, which is harmless.
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

let defaultController: InstallController | null = null;

/** The app-wide controller, backed by the default store. */
export function getInstallController(): InstallController {
  defaultController ??= new InstallController({
    settings: getDefaultStore,
    standalone: runningStandalone,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
  });
  return defaultController;
}
