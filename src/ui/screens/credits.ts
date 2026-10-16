import { el } from "../dom";
import { routeHref } from "../router";
import type { RenderScreen } from "./screen";

/** Who recorded the hen calls the app ships, under which license. Mirrors CREDITS.md (a test keeps them equal). */

export interface Credit {
  /** The xeno-canto catalogue number, such as "XC964309". */
  recording: string;
  recordingUrl: string;
  recordist: string;
  license: string;
  licenseUrl: string;
  /** Which clips and test fixtures were cut from it. */
  usedFor: string;
}

export interface NotUsedRecording extends Omit<Credit, "usedFor"> {
  reason: string;
}

const BY_NC_SA_4 = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const BY_NC_SA_3 = "https://creativecommons.org/licenses/by-nc-sa/3.0/";

export const credits: readonly Credit[] = [
  {
    recording: "XC964309",
    recordingUrl: "https://xeno-canto.org/964309",
    recordist: "Thomas G. Graves",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: BY_NC_SA_4,
    usedFor: "Clips hail.mp3 (99.3-102.1 s) and chuckle.mp3 (23.5-29.5 s); test fixtures hail_a.wav, chuckle_a.wav",
  },
  {
    recording: "XC692779",
    recordingUrl: "https://xeno-canto.org/692779",
    recordist: "Barry Edmonston",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: BY_NC_SA_4,
    usedFor: "Clip quack.mp3 (2.4-4.0 s); test fixture steady_quacks.wav (2.4-12.0 s)",
  },
  {
    recording: "XC11494",
    recordingUrl: "https://xeno-canto.org/11494",
    recordist: "Allen T. Chartier",
    license: "CC BY-NC-SA 3.0",
    licenseUrl: BY_NC_SA_3,
    usedFor: "Test fixture quacks_4.wav (5.1-6.7 s)",
  },
  {
    recording: "XC840246",
    recordingUrl: "https://xeno-canto.org/840246",
    recordist: "Jorge Leitão",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: BY_NC_SA_4,
    usedFor: "Test fixture hail_b.wav (2.9-4.6 s)",
  },
];

export const notUsed: readonly NotUsedRecording[] = [
  {
    recording: "XC196999",
    recordingUrl: "https://xeno-canto.org/196999",
    recordist: "Herman van der Meer",
    license: "CC BY-NC-ND 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    reason: "The no-derivatives term forbids trimmed excerpts, so it is not bundled and has no test fixture.",
  },
];

const XENO_CANTO_URL = "https://xeno-canto.org";
/** The Milestone-1 page that shows what the phone's microphone really delivers. */
export const DIAGNOSTICS_PATH = "diagnostics.html";

/** Opens outside the app, without telling the other site where the visitor came from. */
function externalLink(href: string, text: string): HTMLElement {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
}

function detail(term: string, ...description: (Node | string)[]): HTMLElement[] {
  return [el("dt", {}, term), el("dd", {}, ...description)];
}

function creditView(credit: Credit): HTMLElement {
  return el(
    "li",
    { class: "credit" },
    el("h3", {}, externalLink(credit.recordingUrl, `Recording ${credit.recording}`)),
    el(
      "dl",
      {},
      ...detail("Recordist", credit.recordist),
      ...detail("License", externalLink(credit.licenseUrl, credit.license)),
      ...detail("Used for", credit.usedFor),
    ),
  );
}

function notUsedView(recording: NotUsedRecording): HTMLElement {
  return el(
    "p",
    {},
    externalLink(recording.recordingUrl, recording.recording),
    ` (${recording.recordist}) is licensed `,
    externalLink(recording.licenseUrl, recording.license),
    `. ${recording.reason}`,
  );
}

export const renderCredits: RenderScreen = (root) => {
  root.append(
    el("a", { class: "back-link", href: routeHref({ name: "home" }), "aria-label": "Back to Home" }, "‹ Home"),
    el("h1", { tabindex: "-1" }, "Credits"),
    el(
      "p",
      { class: "lead" },
      "The hen recordings in Duck Call Coach come from ",
      externalLink(XENO_CANTO_URL, "xeno-canto"),
      ".",
    ),
    el(
      "p",
      {},
      "Each one has been trimmed, and the clips the app plays were also converted to mono and normalized in level. " +
        "All are licensed for non-commercial use with attribution and share-alike (CC BY-NC-SA), so the trimmed " +
        "clips are shared under the same license.",
    ),
    el("ul", { class: "credit-list" }, ...credits.map(creditView)),
    el("h2", {}, "Recordings not used"),
    ...notUsed.map(notUsedView),
    el("p", { class: "hint" }, "Test fixtures are used only by the app's automated tests and aren't part of the app."),
    el("h2", {}, "About this app"),
    el(
      "p",
      {},
      el("a", { class: "button secondary", href: `${import.meta.env.BASE_URL}${DIAGNOSTICS_PATH}` }, "Mic check (diagnostics)"),
    ),
    el("p", { class: "hint" }, `Build ${__BUILD_ID__}`),
  );
  return () => undefined;
};
