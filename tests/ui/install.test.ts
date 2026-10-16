import { describe, expect, it, vi } from "vitest";
import {
  INSTALL_DISMISSED_SETTING,
  InstallController,
  installOffer,
  IOS_HINT_SHOWN_SETTING,
  isIosSafari,
  type InstallState,
} from "../../src/ui/install";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_FACEBOOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0]";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

const BASE: InstallState = {
  settingsLoaded: true,
  standalone: false,
  promptReady: false,
  dismissed: false,
  iosSafari: false,
  iosHintShownBefore: false,
};

describe("isIosSafari", () => {
  it("recognises Safari on iPhone, and on iPad asking for the desktop site", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 5)).toBe(true);
  });

  it("is false for Android, a Mac, other iPhone browsers and in-app browsers", () => {
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 0)).toBe(false);
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(IPHONE_FACEBOOK, 5)).toBe(false);
  });
});

describe("installOffer", () => {
  it("offers the button once Android has an install prompt ready", () => {
    expect(installOffer({ ...BASE, promptReady: true })).toBe("button");
  });

  it("offers nothing until the browser has a prompt", () => {
    expect(installOffer(BASE)).toBe("none");
  });

  it("stops offering the button once dismissed", () => {
    expect(installOffer({ ...BASE, promptReady: true, dismissed: true })).toBe("none");
  });

  it("offers nothing when already running as an installed app", () => {
    expect(installOffer({ ...BASE, standalone: true, promptReady: true })).toBe("none");
    expect(installOffer({ ...BASE, standalone: true, iosSafari: true })).toBe("none");
  });

  it("offers nothing before the saved settings are known, so nothing flashes up and away", () => {
    expect(installOffer({ ...BASE, settingsLoaded: false, promptReady: true })).toBe("none");
    expect(installOffer({ ...BASE, settingsLoaded: false, iosSafari: true })).toBe("none");
  });

  it("gives Safari on iPhone the hint, on one launch only", () => {
    expect(installOffer({ ...BASE, iosSafari: true })).toBe("ios-hint");
    expect(installOffer({ ...BASE, iosSafari: true, iosHintShownBefore: true })).toBe("none");
  });
});

/** The parts of beforeinstallprompt the controller uses. */
class FakeInstallPrompt extends Event {
  readonly prompt = vi.fn(async () => undefined);
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;

  constructor(outcome: "accepted" | "dismissed") {
    super("beforeinstallprompt", { cancelable: true });
    this.userChoice = Promise.resolve({ outcome, platform: "web" });
  }
}

function controllerWith(options: { saved?: Record<string, unknown>; ios?: boolean; standalone?: boolean } = {}) {
  const saved = new Map(Object.entries(options.saved ?? {}));
  const settings = {
    getSetting: vi.fn(async (key: string) => saved.get(key)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      saved.set(key, value);
    }),
  };
  const target = new EventTarget();
  const controller = new InstallController({
    settings: async () => settings,
    standalone: () => options.standalone ?? false,
    iosSafari: options.ios ?? false,
  });
  return { controller, target, settings, saved };
}

describe("InstallController", () => {
  it("holds back the browser's own prompt and offers the button instead", async () => {
    const { controller, target } = controllerWith();
    await controller.start(target);
    const event = new FakeInstallPrompt("accepted");
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.offer()).toBe("button");
  });

  it("tells subscribers when the offer changes, until they unsubscribe", async () => {
    const { controller, target } = controllerWith();
    await controller.start(target);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    target.dispatchEvent(new FakeInstallPrompt("accepted"));
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    target.dispatchEvent(new Event("appinstalled"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("shows the browser's prompt on install, and stops offering once accepted", async () => {
    const { controller, target, saved } = controllerWith();
    await controller.start(target);
    const event = new FakeInstallPrompt("accepted");
    target.dispatchEvent(event);
    await controller.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(controller.offer()).toBe("none");
    expect(saved.has(INSTALL_DISMISSED_SETTING)).toBe(false);
  });

  it("remembers a refusal in the browser's prompt as a dismissal", async () => {
    const { controller, target, saved } = controllerWith();
    await controller.start(target);
    target.dispatchEvent(new FakeInstallPrompt("dismissed"));
    await controller.install();
    expect(controller.offer()).toBe("none");
    expect(saved.get(INSTALL_DISMISSED_SETTING)).toBe(true);
  });

  it("remembers Not now across launches", async () => {
    const first = controllerWith();
    await first.controller.start(first.target);
    first.target.dispatchEvent(new FakeInstallPrompt("accepted"));
    await first.controller.dismiss();
    expect(first.controller.offer()).toBe("none");

    const next = controllerWith({ saved: Object.fromEntries(first.saved) });
    await next.controller.start(next.target);
    next.target.dispatchEvent(new FakeInstallPrompt("accepted"));
    expect(next.controller.offer()).toBe("none");
  });

  it("stops offering once the app is installed some other way", async () => {
    const { controller, target } = controllerWith();
    await controller.start(target);
    target.dispatchEvent(new FakeInstallPrompt("accepted"));
    target.dispatchEvent(new Event("appinstalled"));
    expect(controller.offer()).toBe("none");
  });

  it("keeps the iPhone hint up for this launch once shown, and not on the next", async () => {
    const first = controllerWith({ ios: true });
    await first.controller.start(first.target);
    expect(first.controller.offer()).toBe("ios-hint");
    await first.controller.markHintShown();
    expect(first.saved.get(IOS_HINT_SHOWN_SETTING)).toBe(true);
    expect(first.controller.offer()).toBe("ios-hint");

    const next = controllerWith({ ios: true, saved: Object.fromEntries(first.saved) });
    await next.controller.start(next.target);
    expect(next.controller.offer()).toBe("none");
  });

  it("still offers install when saved settings can't be read", async () => {
    const target = new EventTarget();
    const controller = new InstallController({
      settings: () => Promise.reject(new Error("IndexedDB unavailable")),
      standalone: () => false,
      iosSafari: false,
    });
    await controller.start(target);
    target.dispatchEvent(new FakeInstallPrompt("accepted"));
    expect(controller.offer()).toBe("button");
    await expect(controller.dismiss()).resolves.toBeUndefined();
    expect(controller.offer()).toBe("none");
  });

  it("offers nothing when running as an installed app", async () => {
    const { controller, target } = controllerWith({ standalone: true });
    await controller.start(target);
    target.dispatchEvent(new FakeInstallPrompt("accepted"));
    expect(controller.offer()).toBe("none");
  });
});
