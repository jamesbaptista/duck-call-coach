# Duck Call Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A home-screen web app for an Android phone that records a mallard duck call attempt, measures it against real hen mallard targets (or a user-loaded reference), and shows a score, a chart and 2-3 coaching tips, with history kept on the phone.

**Architecture:** A static TypeScript single-page app served from GitHub Pages. Pure, browser-free `analysis` and `scoring` modules (tested in Node against real hen recordings) run in a Web Worker. Thin `capture`, `storage` and `ui` modules wrap the browser APIs. All data stays in IndexedDB on the phone.

**Tech Stack:** TypeScript 5, Vite 6, Vitest 3, fake-indexeddb (dev only). Web Audio (AudioWorklet, AnalyserNode), MediaRecorder, IndexedDB, Service Worker. Python 3 with numpy and soundfile, for a one-time fixture/clip script only.

**Spec:** `docs/superpowers/specs/2026-10-16-duck-call-coach-design.md`. Research data: `docs/research/2026-10-15-hen-mallard-measurements.md`.

## Global Constraints

- No runtime dependencies. Dev dependencies: `vite`, `typescript`, `vitest`, plus `fake-indexeddb` for storage tests (a dev-only addition to the spec's list).
- Every analysis parameter lives in `src/config/analysis.ts`, with the spec section 4 values verbatim: high-pass 200 Hz; frames 40 ms, hop 10 ms; floor = 10th percentile; on floor+12 dB, off floor+8 dB; merge gaps < 25 ms; min note 30 ms; dip 6 dB within 250 ms; tail <= 100 ms, starts < 120 ms after, >= 12 dB quieter; peak-relative edges 18 dB; resonance 800-4000 Hz with 150 Hz smoothing; fundamental from 1-4 kHz, lags 100-700 Hz, strength >= 0.25; squeak in 30 ms slices / 15 ms hop, +-150 Hz window above 2.6 kHz over 0.3-6 kHz energy, skip notes > 20 dB below the loudest; flatness over 0.3-6 kHz; sequence gap 0.6 s; burst gap 0.25 s; SNR gate 15 dB; clipping > 0.5% of samples at >= 0.99.
- Recording: processing off (`echoCancellation`, `noiseSuppression`, `autoGainControl` all false, mono), stop after 1.5 s of silence following at least one note, hard stop at 15 s.
- No network requests besides loading the app itself. A Content Security Policy limited to `'self'` (plus `blob:`/`data:` where media needs it) on production builds. No analytics or CDNs.
- Recordings and measurements never leave the phone, except through the user's own Back up file.
- Never put user-supplied or imported text (reference names, file names, backup contents) into `innerHTML`. Build DOM with `textContent`.
- Every saved attempt stores `analyzerVersion` (constant `ANALYZER_VERSION = "1.0.0"`).
- Bundled hen audio uses only recordings whose license allows redistribution of trimmed clips with attribution (CC BY-NC-SA). Every bundled clip appears in `CREDITS.md` and on the Credits screen.
- Primary device: Android Chrome. iPhone Safari must not break (MediaRecorder `audio/mp4` fallback).
- Copy: plain English, second person, numbers with units ("ms", "dB", "kHz").

## Review Focus

1. **A "recording" with no call in it** (silence, room noise, wind). Expected: "Didn't hear a call", never a score. Pinned in Task 8 (`analyze` on silence and on white noise).
2. **A clipped recording** (phone held at the call's bell). Expected: "Too loud, hold the phone further away", no score. Pinned in Task 8 (hard-clipped hail fixture).
3. **A phone whose microphone runs at 44.1 kHz instead of 48 kHz.** Expected: the same measurements within tolerance. Pinned in Task 8 (hail fixture resampled to 44.1 kHz).
4. **A hand-edited, truncated or hostile Back up file.** Expected: the whole file is rejected with a message and nothing is written. Pinned in Task 15.
5. **Reference names and imported file names containing HTML.** Expected: shown as literal text. Pinned in Task 16 (a source scan test forbidding `innerHTML`/`insertAdjacentHTML`/`outerHTML` assignments in `src/`).

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, diagnostics.html, .gitignore, CREDITS.md
.github/workflows/deploy.yml
scripts/make_assets.py              one-time: trims fixtures + clips from xeno-canto originals
public/clips/{hail,quack,chuckle}.mp3
public/icons/{icon-192,icon-512}.png, public/manifest.webmanifest
src/
  config/analysis.ts                every analysis parameter + ANALYZER_VERSION
  analysis/types.ts                 CallType, Note, CallMeasurements, QualityIssue, AnalysisResult
  analysis/fft.ts                   real FFT, power spectrum helpers
  analysis/filter.ts                4th-order Butterworth high-pass, forward-backward
  analysis/frames.ts                per-frame RMS dB
  analysis/notes.ts                 note finding (spec 4.4)
  analysis/noteFeatures.ts          resonance, fundamental, squeak share, flatness, live resonance
  analysis/measure.ts               sequences, call-level measurements
  analysis/quality.ts               clipping fraction, quality gate
  analysis/analyze.ts               analyze(): orchestrates the pipeline
  analysis/worker.ts, analysis/client.ts   Web Worker + promise wrapper
  scoring/types.ts, scoring/targets.json, scoring/score.ts
  scoring/reference.ts              reference-mode ranges, flatness baseline, DTW pairing
  scoring/tips.json, scoring/tips.ts
  capture/recorder.ts, capture/pcm-worklet.ts, capture/autostop.ts, capture/mime.ts
  storage/db.ts, storage/backup.ts
  ui/dom.ts, ui/router.ts, ui/styles.css, ui/main.ts
  ui/screens/{home,practice,results,history,references,credits}.ts
  ui/charts/{notesChart,historyChart,targetShape}.ts
  ui/diagnostics.ts                 Milestone 1 recorder page
  sw-template.js                    service worker source; the build plugin fills the asset list
tests/  (mirrors src/) plus tests/fixtures/*.wav, tests/helpers/{wav,plant,synth}.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/ui/main.ts`, `tests/sanity.test.ts`

**Interfaces:**
- Produces: `npm test` (Vitest, Node environment), `npm run build` (`tsc --noEmit && vite build`), `npm run dev`. Vite `base: "/duck-call-coach/"`. Multi-page inputs `index.html` and `diagnostics.html` (the latter added in Task 2).

- [ ] **Step 1:** `git init`, then create `package.json` with scripts `dev`, `build`, `preview`, `test` (`vitest run`) and dev dependencies `vite`, `typescript`, `vitest`, `fake-indexeddb`. Run `npm install`.
- [ ] **Step 2:** `tsconfig.json`: `strict: true`, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `resolveJsonModule: true`, `lib: ["ES2022","DOM","DOM.Iterable","WebWorker"]`, include `src` and `tests`.
- [ ] **Step 3:** `vite.config.ts` with `base`, `build.rollupOptions.input` = `{ main: "index.html" }`, `test: { environment: "node" }`, and a build-only plugin (`apply: "build"`, `transformIndexHtml`) that adds this meta tag to every HTML page:
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'">`
- [ ] **Step 4:** Write `tests/sanity.test.ts` asserting `1 + 1 === 2`, and a minimal `index.html` that loads `src/ui/main.ts` (which sets `document.title`).
- [ ] **Step 5:** Run `npm test` and `npm run build`. Expected: 1 test passes, `dist/index.html` contains the CSP meta tag.
- [ ] **Step 6:** Commit: `chore: scaffold Vite + TypeScript + Vitest project`.

### Task 2: Capture module and diagnostics page (Milestone 1 recorder)

**Files:**
- Create: `src/capture/mime.ts`, `src/capture/autostop.ts`, `src/capture/pcm-worklet.ts`, `src/capture/recorder.ts`, `diagnostics.html`, `src/ui/diagnostics.ts`
- Test: `tests/capture/mime.test.ts`, `tests/capture/autostop.test.ts`, `tests/capture/settings.test.ts`
- Modify: `vite.config.ts` (add `diagnostics: "diagnostics.html"` input)

**Interfaces:**
- Produces:
  - `pickMimeType(isSupported: (t: string) => boolean): string | null`: first supported of `"audio/webm;codecs=opus"`, `"audio/mp4"`, `"audio/webm"`, else `null`.
  - `interface ProcessingReport { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null; processingOff: boolean }` and `toProcessingReport(settings: MediaTrackSettings): ProcessingReport`. `processingOff` is true only when all three are exactly `false`. A missing key becomes `null`.
  - `class AutoStop { constructor(opts?: { silenceS?: number; maxS?: number; riseDb?: number }); update(levelDb: number, tS: number): boolean }`. Defaults 1.5 s, 15 s, 12 dB. Ambient = 20th percentile of all levels seen so far. A "note" is any level >= ambient + riseDb. Returns true once a note has been seen and the level has stayed below ambient + riseDb for `silenceS`, or when `tS >= maxS`.
  - `interface RecordingResult { pcm: Float32Array; sampleRate: number; blob: Blob; mimeType: string; durationMs: number; processing: ProcessingReport }`
  - `interface RecordingSession { processing: ProcessingReport; onLevel(cb: (levelDb: number, freqDb: Float32Array, binHz: number) => void): void; stop(): Promise<RecordingResult>; cancel(): void }`
  - `startRecording(): Promise<RecordingSession>`: rejects with `Error` whose `name` is `"NotAllowedError"` (mic denied) or `"NotSupportedError"` (no AudioWorklet or MediaRecorder).

- [ ] **Step 1: Write failing tests.** `mime.test.ts`: a stub supporting only `audio/mp4` returns `"audio/mp4"`; a stub supporting nothing returns `null`. `settings.test.ts`: `{echoCancellation:false,noiseSuppression:false,autoGainControl:false}` gives `processingOff: true`; `{echoCancellation:true,...}` gives false; `{}` gives all `null` and false. `autostop.test.ts`: feed 0.5 s of -60 dB at 10 ms steps, then 0.3 s of -20 dB, then -60 dB: `update` returns false until 1.5 s after the loud part ends, then true; feed only -60 dB for 15 s: returns true at `tS >= 15`; a loud burst at 14.9 s still stops at 15 s.
- [ ] **Step 2:** Run `npx vitest run tests/capture`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `mime.ts`, `toProcessingReport` (in `recorder.ts`, exported) and `autostop.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Implement `pcm-worklet.ts`, an `AudioWorkletProcessor` registered as `"pcm-capture"` that posts each input block's channel 0 as a transferable `Float32Array`. Load it in `recorder.ts` with `audioWorklet.addModule(new URL("./pcm-worklet.ts", import.meta.url))`. Implement `startRecording()`: `getUserMedia` with the Global Constraints settings, an `AudioContext`, source → worklet node (concatenate blocks) and source → AnalyserNode (`fftSize` 2048, levels via `requestAnimationFrame`), `MediaRecorder` with `pickMimeType`. `stop()` stops all tracks, closes the context, and resolves when MediaRecorder's final `dataavailable` arrives.
- [ ] **Step 6:** Implement `diagnostics.html` + `src/ui/diagnostics.ts`: a Record/Stop button; the `ProcessingReport` printed as text; a live level bar; after stop: sample rate, duration, peak level, mime type, a canvas spectrum of the whole recording (simple FFT magnitude, 0-6 kHz) and an `<audio>` player for the blob. Run `npm run build`. Expected: the build succeeds with two HTML entries.
- [ ] **Step 7:** Commit: `feat: capture module and diagnostics recorder page`.

### Task 3: Deploy to GitHub Pages and check the phone (Milestone 1 gate)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: the site at `https://<github-user>.github.io/duck-call-coach/`, with the diagnostics page at `.../diagnostics.html`.

- [ ] **Step 1:** Write `deploy.yml`: on push to `main` and `workflow_dispatch`; jobs: checkout, `actions/setup-node` (Node 22, npm cache), `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact` (path `dist`), `actions/deploy-pages`. Permissions: `contents: read`, `pages: write`, `id-token: write`.
- [ ] **Step 2: Ask the user before anything public happens.** Confirm in chat: create a **public** GitHub repository `duck-call-coach` under their account and push. Only after a clear yes: `gh repo create duck-call-coach --public --source . --push`, then enable Pages with the source set to GitHub Actions (`gh api -X POST repos/{owner}/duck-call-coach/pages -f build_type=workflow`).
- [ ] **Step 3:** Watch the run (`gh run watch`). Expected: tests and build pass, and the deploy job prints the Pages URL.
- [ ] **Step 4: Phone check, done by the user on their Android phone in Chrome.** Open the diagnostics page, allow the microphone, and record about 5 s of calling. Report: (a) the three processing values and `processingOff`; (b) the sample rate; (c) whether playback sounds natural; (d) a screenshot of the spectrum. **Gate:** if `processingOff` is false, or the spectrum shows energy above 2 kHz chopped off or pumping, stop and adapt the capture approach (for example `getUserMedia` with `{ audio: { voiceIsolation: false } }`, or a different mic source) before Task 4.
- [ ] **Step 5:** Commit any workflow fixes: `ci: deploy to GitHub Pages`.

### Task 4: Test fixtures, bundled clips and credits

**Files:**
- Create: `scripts/make_assets.py`, `tests/fixtures/*.wav`, `public/clips/hail.mp3`, `public/clips/quack.mp3`, `public/clips/chuckle.mp3`, `CREDITS.md`, `tests/helpers/wav.ts`, `tests/helpers/wav.test.ts`

**Interfaces:**
- Consumes: the original xeno-canto files from the research downloads folder (passed as an argument).
- Produces:
  - `readWav(path: string): { samples: Float32Array; sampleRate: number }` (16-bit PCM mono WAV only; throws otherwise).
  - Fixtures (16-bit mono WAV at the original rate):

| Fixture | Source | Window (s) |
|---|---|---|
| `hail_a.wav` | XC964309 | 99.3-102.1 |
| `chuckle_a.wav` | XC964309 | 23.5-29.5 |
| `quacks_4.wav` | XC11494 | 5.1-6.7 |
| `steady_quacks.wav` | XC692779 | 2.4-12.0 |
| `hail_b.wav` | XC840246 | 2.9-4.6 (only if its license is verified as CC BY-NC-SA or more permissive) |
| `hail_c.wav` | XC196999 | 0.8-3.3 (same condition) |

  - Clips: `hail.mp3` = hail_a window, `quack.mp3` = XC692779 2.4-4.0 s, `chuckle.mp3` = chuckle_a window. 128 kbps mono MP3, normalized to -1 dBFS peak.

- [ ] **Step 1:** Open `https://xeno-canto.org/840246` and `https://xeno-canto.org/196999` and read each License line. Record the result in `CREDITS.md`. Drop the fixture for any recording that is ND (no derivatives) or unlicensed.
- [ ] **Step 2:** Write `scripts/make_assets.py <source_dir> <repo_root>`: numpy + soundfile; downmix to mono; slice the windows; write the WAVs as `PCM_16`; write MP3 clips with `format="MP3"`. Run it in a throwaway Python environment.
- [ ] **Step 3:** Write `CREDITS.md`: for each source, the XC number, recordist, URL, license, and which fixture or clip uses it (XC964309 Thomas G. Graves, CC BY-NC-SA 4.0; XC692779 Barry Edmonston, CC BY-NC-SA 4.0; XC11494 Allen T. Chartier, CC BY-NC-SA 3.0; plus any verified in Step 1).
- [ ] **Step 4: Failing test** `wav.test.ts`: `readWav("tests/fixtures/hail_a.wav")` has `sampleRate === 48000` and `samples.length` within 1 sample of `2.8 * 48000`, with all samples in [-1, 1].
- [ ] **Step 5:** Run it. Expected: FAIL. Implement `readWav` (RIFF chunk walk; find `fmt ` and `data`). Run it. Expected: PASS.
- [ ] **Step 6:** Commit: `test: hen recording fixtures, bundled clips and credits`.

### Task 5: DSP primitives (FFT, high-pass, frame levels)

**Files:**
- Create: `src/config/analysis.ts`, `src/analysis/fft.ts`, `src/analysis/filter.ts`, `src/analysis/frames.ts`
- Test: `tests/analysis/dsp.test.ts`, `tests/helpers/synth.ts`

**Interfaces:**
- Produces:
  - `ANALYSIS` (a frozen object holding every Global Constraints analysis value, with names such as `highPassHz`, `frameS`, `hopS`, `floorPercentile`, `onDb`, `offDb`, `mergeGapS`, `minNoteS`, `dipDb`, `dipLookaheadS`, `tailMaxS`, `tailGapS`, `tailDropDb`, `edgeDb`, `resonanceLoHz`, `resonanceHiHz`, `resonanceSmoothHz`, `fundBandLoHz`, `fundBandHiHz`, `fundLagLoHz`, `fundLagHiHz`, `fundMinStrength`, `squeakSliceS`, `squeakHopS`, `squeakLoHz`, `squeakHalfWidthHz`, `squeakBandLoHz`, `squeakBandHiHz`, `squeakSkipBelowDb`, `flatLoHz`, `flatHiHz`, `sequenceGapS`, `burstGapS`, `minSnrDb`, `clipLevel`, `clipFraction`) and `ANALYZER_VERSION = "1.0.0"`.
  - `nextPow2(n: number): number`
  - `powerSpectrum(x: Float32Array, nfft: number, window?: "hann" | "none"): Float32Array` (length `nfft/2 + 1`; zero-pads x)
  - `highPass(x: Float32Array, sampleRate: number, cutoffHz?: number): Float32Array`: two cascaded RBJ high-pass biquads with Q = 0.5412 and 1.3066 (4th-order Butterworth), run forward then backward.
  - `frameLevelsDb(x: Float32Array, sampleRate: number): Float32Array` (RMS dB per frame, `20*log10(rms + 1e-9)`; frame `round(frameS*sr)`, hop `round(hopS*sr)`; the frame count matches the research script).
  - `tests/helpers/synth.ts`: `sine(freq, seconds, sr, amp?)`, `harmonicNote({ f0, formantHz, seconds, sr, amp? })` (harmonics of f0 up to 6 kHz, amplitude shaped by a Gaussian of width 400 Hz centered on formantHz), `whiteNoise(seconds, sr, amp, seed)`, `silence(seconds, sr)`, `concat(...parts)`.

- [ ] **Step 1: Failing tests.** For a 1 kHz sine at 48 kHz with nfft 4096, the peak bin of `powerSpectrum` is within 1 bin of 1000 Hz. `highPass` attenuates a 50 Hz sine's RMS by >= 30 dB and changes a 1 kHz sine's RMS by < 1 dB (ignore the first and last 0.1 s). `frameLevelsDb` of a full-scale sine is within 0.5 dB of -3.01 dB, and 1.0 s at 48 kHz gives `floor((48000-1920)/480)+1 = 97` frames.
- [ ] **Step 2:** Run `npx vitest run tests/analysis/dsp.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `config/analysis.ts`, `fft.ts` (iterative radix-2 complex FFT on the real input), `filter.ts` and `frames.ts`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: analysis config and DSP primitives`.

### Task 6: Note finding

**Files:**
- Create: `src/analysis/types.ts`, `src/analysis/notes.ts`
- Test: `tests/analysis/notes.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  - `type CallType = "quack" | "hail" | "comeback" | "chuckle"`
  - `interface NoteSpan { startFrame: number; endFrame: number }` (end exclusive)
  - `noiseFloorDb(levels: Float32Array): number` (in `notes.ts`)
  - `findNotes(levels: Float32Array, floorDb: number): NoteSpan[]` (in `notes.ts`): the full spec 4.4 sequence, in order: hysteresis, merge gaps, dip split, drop short notes, tail merge, peak-relative edges.

Dip split and peak-relative edges are not pinned by the spec's wording, so implement exactly this:

```ts
// Dip split inside one loud region [s, e): smooth levels with a 3-frame moving average.
// Walk local minima i (seg[i] <= neighbours). Cut at i when
//   max(seg[lastCut..i]) - seg[i] >= dipDb  AND  max(seg[i .. i+lookahead]) - seg[i] >= dipDb
//   AND (i - lastCut) * hopS >= minNoteS,   where lookahead = round(dipLookaheadS / hopS).
// Peak-relative edges: for each final span, peak = max(levels in span); move start forward
// and end backward while the frame level is < peak - edgeDb (never past each other).
```

- [ ] **Step 1: Failing tests (synthetic level arrays, hop 10 ms, floor -60 dB):**
  - one block of -20 dB frames 30 long → one note, frames [start, end) exact;
  - two blocks separated by a 2-frame gap at -60 dB → merged into one note (gap 20 ms < 25 ms);
  - a 2-frame block → no notes (20 ms < 30 ms);
  - a loud region shaped as 15 frames at -20, 5 frames at -30, 15 frames at -20 → two notes (dip 10 dB >= 6);
  - same but the dip at -24 → one note (4 dB < 6);
  - a 20-frame note at -20 dB, a 5-frame gap, then an 8-frame blip at -35 dB → one note (tail merged: 80 ms, 50 ms gap, 15 dB quieter);
  - same with a 12-frame blip (120 ms) → two notes (too long to be a tail);
  - a note with 5-frame ramps at -55 dB at both ends around a -20 dB core → edges trimmed to the core (frames below -38 dB removed).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `noiseFloorDb` (10th percentile, linear interpolation) and `findNotes`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Add a fixture test: `quacks_4.wav` → highPass → frames → findNotes gives exactly 4 notes with onsets within 20 ms of 5.25, 5.62, 6.02 and 6.37 s (fixture-relative: 0.15, 0.52, 0.92, 1.27 s). Run. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: note finding with dip split and echo-tail merge`.

### Task 7: Per-note features

**Files:**
- Create: `src/analysis/noteFeatures.ts`
- Test: `tests/analysis/noteFeatures.test.ts`

**Interfaces:**
- Consumes: `powerSpectrum`, `nextPow2`, `ANALYSIS`.
- Produces (all take the high-passed signal `x`, `sampleRate`, and the note's sample range `[s0, s1)`):
  - `resonanceHz(x, sr, s0, s1): number`: nfft = `nextPow2(max(s1-s0, sr/4))`, Hann window; log power smoothed by a moving average of `resonanceSmoothHz`; arg-max frequency in 800-4000 Hz.
  - `fundamentalHz(x, sr, s0, s1): number | null`: as the research `note_spectrum_features`: in the 1-4 kHz band, subtract the smoothed log spectrum, then autocorrelate; best lag in 100-700 Hz; return `lag * binHz` when `ac[lag]/ac[0] >= 0.25`, else `null`.
  - `squeakShare(x, sr, s0, s1): number`: max over 30 ms Hann slices (15 ms hop) of (energy in the strongest +-150 Hz window above 2.6 kHz) / (slice energy 0.3-6 kHz).
  - `flatness(x, sr, s0, s1): number`: geometric mean / arithmetic mean of power over 0.3-6 kHz.
  - `liveResonanceHz(freqDb: Float32Array, binHz: number): number | null`: same smoothing and band as `resonanceHz`, on AnalyserNode dB data; `null` if the band max is below -90 dB.

- [ ] **Step 1: Failing tests (synthetic):** for `harmonicNote({f0: 350, formantHz: 2000, seconds: 0.25, sr: 48000})`, `resonanceHz` is within 60 Hz of 2000, `fundamentalHz` within 15 Hz of 350, and `squeakShare` < 0.5. A 4 kHz sine of 0.25 s gives `squeakShare` >= 0.9. `flatness(whiteNoise)` > 5 x `flatness(harmonicNote)`. `liveResonanceHz` on a dB array with a bump at bin 2000/binHz returns within 60 Hz of 2000.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Fixture test: for each note found in `steady_quacks.wav`, the median `resonanceHz` is within 60 Hz of 2073, and the median of non-null `fundamentalHz` is within 15 Hz of 355. Run. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: per-note resonance, fundamental, squeak and flatness`.

### Task 8: Call measurements, quality gate and `analyze()`

**Files:**
- Create: `src/analysis/measure.ts`, `src/analysis/quality.ts`, `src/analysis/analyze.ts`
- Modify: `src/analysis/types.ts`
- Test: `tests/analysis/analyze.test.ts`

**Interfaces:**
- Produces in `types.ts`:

```ts
interface Note { startS: number; endS: number; durationMs: number; peakDb: number;
  resonanceHz: number; fundamentalHz: number | null; squeakShare: number | null; flatness: number }
interface CallMeasurements { noteCount: number; spacingMs: number | null; spacingCv: number | null;
  burstSpacingMs: number | null; firstNoteMs: number; lastNoteMs: number; medianNoteMs: number;
  lastFirstRatio: number | null;
  loudestIndex: number; fadeDb: number; resonanceHz: number; resonanceSlopeHzPerNote: number | null;
  flatness: number; maxSqueakShare: number; longNoteCount: number; snrDb: number }
type QualityIssue = "clipped" | "too_quiet" | "no_notes" | "too_few_notes"
interface AnalysisResult { callType: CallType; analyzerVersion: string; noiseFloorDb: number;
  notes: Note[]; measurements: CallMeasurements | null; quality: QualityIssue | null }
```

  - `clippedFraction(raw: Float32Array): number` (in `quality.ts`)
  - `buildSequences(notes: Note[]): Note[][]` (split where silence between notes > 0.6 s) and `pickScored(seqs: Note[][], callType: CallType): Note[]` (quack: `[loudest note overall]`; others: the sequence with the most notes, ties to the loudest)
  - `measureCall(notes: Note[], floorDb: number): CallMeasurements`. Definitions: spacing = onset differences; `spacingCv` = population std / mean; `burstSpacingMs` = median of onset differences < 0.25 s (null if none); `loudestIndex` 0-based; `fadeDb` = loudest peak − last peak; `resonanceSlopeHzPerNote` = least-squares slope over note index (null under 3 notes); `squeakShare` is null for notes > 20 dB below the loudest, and `maxSqueakShare` takes the max of the non-null values; `longNoteCount` = notes over 150 ms; `medianNoteMs` = median note duration; `snrDb` = loudest peak − floor.
  - `analyze(raw: Float32Array, sampleRate: number, callType: CallType): AnalysisResult`. Order: clipping check on `raw` → `highPass` → frames → floor → `findNotes` → per-note features → sequences → pick → gate (`no_notes` if none; `too_quiet` if snr < 15 dB; `too_few_notes` if fewer than 3 notes for hail, comeback or chuckle) → `measureCall`. `measurements` is null whenever `quality` is non-null.

- [ ] **Step 1: Failing golden tests (fixtures through `analyze`):**
  - `hail_a.wav` as `"hail"`: `quality` null; `noteCount` 9-10; `spacingMs` 235 ± 10; `spacingCv` <= 0.08; `resonanceHz` 1945 ± 60; first note resonance − last note resonance > 0; `fadeDb` >= 4; `maxSqueakShare` < 0.8.
  - `quacks_4.wav` as `"quack"`: `noteCount` 1; `firstNoteMs` 180-300; `resonanceHz` 1650-2100.
  - `steady_quacks.wav` as `"hail"`: `noteCount` 18-20; `spacingMs` 508 ± 15.
  - `chuckle_a.wav` as `"chuckle"`: `noteCount` 15-25; median note duration 40-110 ms; `burstSpacingMs` 90-140.
  - `hail_b.wav` / `hail_c.wav` (if present): `noteCount` 4 / 5-6; `spacingMs` 350 ± 15 / 370 ± 20.
- [ ] **Step 2: Failing Review Focus tests:**
  - 3 s of `silence` → `quality === "no_notes"`; 3 s of `whiteNoise(amp 0.05)` → `quality` is `"no_notes"` or `"too_quiet"`, never null.
  - `hail_a` multiplied by 20 and hard-clipped to [-1, 1] → `quality === "clipped"`.
  - `hail_a` resampled to 44.1 kHz by linear interpolation → `noteCount`, `spacingMs` (± 10), `resonanceHz` (± 60) and `fadeDb` (± 2) match the 48 kHz result.
  - one `harmonicNote` alone as `"hail"` → `quality === "too_few_notes"`.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement `measure.ts`, `quality.ts` and `analyze.ts`.
- [ ] **Step 5:** Run. Expected: PASS. If a golden value is off, inspect the detected notes against the research spectrogram before changing anything. A changed expectation must be written into the research doc with the reason.
- [ ] **Step 6:** Commit: `feat: call measurements, quality gate and analyze()`.

### Task 9: Planted-mistake regression tests

**Files:**
- Create: `tests/helpers/plant.ts`, `tests/analysis/planted.test.ts`

**Interfaces:**
- Consumes: `analyze`, `highPass`, `frameLevelsDb`, `noiseFloorDb`, `findNotes`.
- Produces in `plant.ts`, each taking `(samples, sampleRate)` of a clean hail and returning a new `Float32Array`. Notes are cut out with 30 ms padding and re-placed on a bed of Gaussian noise at the floor RMS (seeded PRNG, seed 7):
  - `rushed`: each note keeps its first 60% (20 ms linear fade-out), spacing x 0.6
  - `dragging`: spacing x 1.8
  - `uneven`: each spacing x uniform(0.55, 1.45)
  - `noFade`: every note scaled to the loudest note's peak
  - `tooMany`: notes `[all, middle notes, middle notes]` at the original spacing
  - `squeak`: an 80 ms chirp sweeping 3800-4200 Hz, amplitude 0.7 x note-1 peak, Hann-windowed, added at the start of note 1
  - `raspy`: add noise of std 0.8 x (200-sample moving average of |note|), per note
  - `pitchHigh`: resample the whole clip by a factor 1.3 (the call gets higher and faster)

- [ ] **Step 1: Write the tests.** For each fixture hail (`hail_a`, plus `hail_b`/`hail_c` if present), the clean analysis passes its built-in hail ranges on the measure under test, and the planted version crosses the boundary: rushed `spacingMs` < 230; dragging `spacingMs` > 370; uneven `spacingCv` > 0.15; noFade `fadeDb` < 4; tooMany `noteCount` > 10; squeak `maxSqueakShare` >= 0.8; raspy `flatness` > 1.4 x clean; pitchHigh `resonanceHz` > 2400.
- [ ] **Step 2:** Run `npx vitest run tests/analysis/planted.test.ts`. Expected: PASS if Tasks 6-8 are right. A failure here is a detection bug: fix the analysis, not the thresholds. Only the planted magnitudes may be strengthened, and only if the planted change is clearly too weak to be a real mistake (record why in the research doc).
- [ ] **Step 3:** Commit: `test: planted-mistake regression suite`.

### Task 10: Analysis worker

**Files:**
- Create: `src/analysis/worker.ts`, `src/analysis/client.ts`
- Test: `tests/analysis/client.test.ts`

**Interfaces:**
- Produces: `analyzeInWorker(pcm: Float32Array, sampleRate: number, callType: CallType): Promise<AnalysisResult>`. The worker message is `{ id: number; pcm: Float32Array; sampleRate: number; callType: CallType }` with the PCM buffer transferred. The reply is `{ id; result: AnalysisResult } | { id; error: string }`; an error reply rejects the promise. `client.ts` exports `createAnalysisClient(makeWorker: () => Worker)` for tests, plus the default `analyzeInWorker`, which uses `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.

- [ ] **Step 1: Failing test** with a fake Worker object (records `postMessage`, lets the test emit replies): two concurrent calls resolve to their own results by `id`, and an `error` reply rejects with that message.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Commit: `feat: run analysis in a Web Worker`.

### Task 11: Targets and scoring

**Files:**
- Create: `src/scoring/types.ts`, `src/scoring/targets.json`, `src/scoring/score.ts`
- Test: `tests/scoring/score.test.ts`

**Interfaces:**
- Produces:

```ts
type SubScore = "rhythm" | "notes" | "pitch" | "tone";
type MeasureKey = keyof Omit<CallMeasurements, "snrDb" | "lastNoteMs">;
interface MeasureTarget { key: MeasureKey; lo: number; hi: number; tolerance: number; weight: number; sub: SubScore }
interface CallTargets { callType: CallType; confidence: "high" | "medium" | "low"; description: string;
  measures: MeasureTarget[]; subWeights: Record<SubScore, number> }
interface MeasureScore { key: MeasureKey; sub: SubScore; value: number | null; lo: number; hi: number;
  score: number | null; weightedLoss: number }
interface Scores { overall: number; subs: Record<SubScore, number | null>; measures: MeasureScore[] }
```

  - `scoreMeasure(value: number, t: MeasureTarget): number`: 100 inside [lo, hi]; outside, `100 * max(0, 1 - distance / tolerance)`.
  - `scoreAttempt(m: CallMeasurements, targets: CallTargets): Scores`: a measure whose value is null gets `score: null` and is skipped. Sub = weighted mean of its measures (null if none). Overall = weighted mean of non-null subs using `subWeights` (weight 0 skips), rounded to an integer. `weightedLoss = (100 - score) * weight * subWeights[sub]`.
  - `loadTargets(callType: CallType): CallTargets` (from `targets.json`).
  - `targets.json` contents (`hi` 999 means no upper limit; `loudestIndex` is 0-based):

| callType | confidence | key | lo | hi | tolerance | weight | sub |
|---|---|---|---|---|---|---|---|
| quack | high | firstNoteMs | 180 | 375 | 150 | 2 | notes |
| | | resonanceHz | 1800 | 2100 | 500 | 2 | pitch |
| | | maxSqueakShare | 0 | 0.8 | 0.2 | 1 | tone |
| hail | high | noteCount | 4 | 10 | 4 | 2 | notes |
| | | spacingMs | 230 | 370 | 120 | 2 | rhythm |
| | | spacingCv | 0 | 0.15 | 0.25 | 1 | rhythm |
| | | lastFirstRatio | 0.3 | 0.7 | 0.3 | 1 | notes |
| | | loudestIndex | 0 | 3 | 3 | 1 | notes |
| | | fadeDb | 4 | 999 | 4 | 1 | notes |
| | | resonanceHz | 1500 | 2400 | 500 | 2 | pitch |
| | | resonanceSlopeHzPerNote | -60 | 10 | 60 | 1 | pitch |
| | | maxSqueakShare | 0 | 0.8 | 0.2 | 1 | tone |
| comeback | low | noteCount | 5 | 10 | 4 | 2 | notes |
| | | spacingMs | 150 | 250 | 100 | 2 | rhythm |
| | | spacingCv | 0 | 0.2 | 0.25 | 1 | rhythm |
| | | loudestIndex | 0 | 1 | 3 | 1 | notes |
| | | fadeDb | 4 | 999 | 4 | 1 | notes |
| | | resonanceHz | 1500 | 2400 | 500 | 1 | pitch |
| | | maxSqueakShare | 0 | 0.8 | 0.2 | 1 | tone |
| chuckle | low | medianNoteMs | 30 | 100 | 60 | 1 | notes |
| | | burstSpacingMs | 100 | 165 | 80 | 2 | rhythm |
| | | longNoteCount | 0 | 0 | 3 | 2 | notes |
| | | maxSqueakShare | 0 | 0.8 | 0.2 | 1 | tone |

  subWeights: quack {rhythm 0, notes 1, pitch 2, tone 2}; hail {rhythm 2, notes 3, pitch 1, tone 1}; comeback {rhythm 2, notes 2, pitch 1, tone 1}; chuckle {rhythm 3, notes 2, pitch 0, tone 1}.
  Descriptions: quack "One clean quack, about a quarter second long."; hail "5-6 notes, each a little shorter and softer, at a steady pace."; comeback "Like the hail but faster and more urgent: a strong first note, then 5-10 quick notes that fade."; chuckle "Quick, short clicks in rolling bursts, with no long quacks mixed in."

- [ ] **Step 1: Failing tests:** `scoreMeasure(300, {lo:230,hi:370,tolerance:120})` = 100; `scoreMeasure(170, …)` = 50; `scoreMeasure(100, …)` = 0. A hail measurement object built from Task 8's `hail_a` result scores overall >= 90. The same object with `spacingMs` 141 makes rhythm the lowest sub and the largest `weightedLoss` the `spacingMs` entry. A chuckle never produces a pitch sub (null) and its overall ignores pitch. A null `spacingCv` is skipped rather than scored 0.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Commit: `feat: target ranges and scoring`.

### Task 12: Reference mode, flatness baseline and note pairing

**Files:**
- Create: `src/scoring/reference.ts`
- Test: `tests/scoring/reference.test.ts`

**Interfaces:**
- Consumes: `CallTargets`, `CallMeasurements`, `Note`.
- Produces:
  - `targetsFromReference(builtIn: CallTargets, ref: CallMeasurements): CallTargets`. It replaces ranges for keys present in `builtIn`: `spacingMs` ± 15%; `noteCount` ± 1; `resonanceHz` ± 150 Hz; `firstNoteMs` and `medianNoteMs` ± 20%; `fadeDb` ± 4 dB (lower bound floored at 0). Tolerances and other measures are unchanged. Confidence is set to `"high"`.
  - `withFlatnessBaseline(t: CallTargets, baseline: number | null): CallTargets`. With a baseline, it appends `{ key: "flatness", lo: 0.6*b, hi: 1.4*b, tolerance: 0.6*b, weight: 1, sub: "tone" }`; with null it returns `t` unchanged.
  - `pairNotes(attempt: Note[], ref: Note[]): Array<[number | null, number | null]>`: DTW over features [onset / total duration, durationMs / max duration, peakDb − max peakDb (in units of 10 dB), (resonanceHz − 2000) / 500], Euclidean cost; backtrack. Unmatched steps give `[i, null]` or `[null, j]`.

- [ ] **Step 1: Failing tests:** a reference with spacing 300 gives a hail spacing range [255, 345]. A baseline of 0.1 adds a flatness target [0.06, 0.14]. A null baseline leaves the targets deep-equal to the input. `pairNotes` on identical 5-note lists pairs i with i. With note 3 removed from the attempt, the pairing has exactly one `[null, 2]` and pairs every other reference note with its attempt counterpart.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Commit: `feat: reference-mode targets and DTW note pairing`.

### Task 13: Coaching tips

**Files:**
- Create: `src/scoring/tips.json`, `src/scoring/tips.ts`
- Test: `tests/scoring/tips.test.ts`

**Interfaces:**
- Produces: `selectTips(callType: CallType, scores: Scores, table?: TipTable): { problems: string[]; positive: string }`. Problems are measures with `weightedLoss > 0`, sorted by loss (descending), at most 3, using key `` `${callType}.${key}.${value < lo ? "low" : "high"}` `` and falling back to `` `any.${key}.${dir}` ``. Placeholders `{value}`, `{lo}` and `{hi}` are formatted per key (ms and Hz as integers, dB with 0 decimals, ratios and CV with 2 decimals, `loudestIndex` + 1 as an ordinal note number, kHz shown as `x.x kHz` for resonance). `positive` comes from the highest non-null sub (`` `positive.${sub}` ``).
- `tips.json` (`any.*` entries apply to every call type unless overridden):

```json
{
  "any.spacingMs.low": "Your notes are {value} ms apart; a hen's are {lo}-{hi} ms. Slow down and give each note its own 'quack'.",
  "any.spacingMs.high": "Your notes are {value} ms apart; aim for {lo}-{hi} ms. Keep the call moving.",
  "any.spacingCv.high": "Your pace changes during the call. Keep the gaps between notes the same, like a steady clock.",
  "any.noteCount.low": "You used {value} notes; aim for {lo}-{hi}.",
  "any.noteCount.high": "You used {value} notes; aim for {lo}-{hi}. Stop sooner, since too many notes sounds unnatural.",
  "any.fadeDb.low": "Your last note is nearly as loud as your loudest. Ease off the air so each note gets softer.",
  "any.lastFirstRatio.high": "Your notes stay long all the way through. Make each note a little shorter than the one before.",
  "any.lastFirstRatio.low": "Your notes shrink too fast. Let the first few notes ring a little longer.",
  "any.loudestIndex.high": "Your loudest note came late (note {value}). Hit the first notes hardest, then taper off.",
  "any.resonanceHz.high": "Your call sounds high and thin ({value}; hens sit around {lo}-{hi}). Use less air pressure and cup your hand more around the end of the call.",
  "any.resonanceHz.low": "Your call sounds low and muffled ({value}; hens sit around {lo}-{hi}). Open your hand a little and push a bit more air.",
  "any.resonanceSlopeHzPerNote.high": "Your notes climb in pitch. Let each note drop a little, like a hen settling down.",
  "any.maxSqueakShare.high": "There's a squeak in your call. That usually means too much air or a pinched reed: back off the air and keep your hand relaxed.",
  "any.flatness.high": "Your call is raspier than your target. Use steadier air and less force.",
  "any.flatness.low": "Your call is cleaner and thinner than your target. A little more back pressure adds natural rasp.",
  "quack.firstNoteMs.low": "Your quack is short ({value} ms). Hold it to about {lo}-{hi} ms: 'quaaack', not 'quack'.",
  "quack.firstNoteMs.high": "Your quack runs long ({value} ms). Cut it off at about {hi} ms.",
  "chuckle.medianNoteMs.high": "Your chuckle notes are too long ({value} ms). Keep each one a quick click under {hi} ms.",
  "chuckle.burstSpacingMs.high": "Your chuckle is slow. Roll the clicks faster: 'tikka-tikka-tikka'.",
  "chuckle.burstSpacingMs.low": "Your chuckle is so fast it blurs. Slow it a touch so each click is clear.",
  "chuckle.longNoteCount.high": "There are {value} long quacks mixed into your chuckle. Keep it all short clicks.",
  "comeback.spacingMs.high": "Your comeback is too slow ({value} ms between notes). Make it urgent: {lo}-{hi} ms.",
  "positive.rhythm": "Your pace is steady. Keep that rhythm.",
  "positive.notes": "Good note count and shape.",
  "positive.pitch": "Your pitch sits right where a hen's does.",
  "positive.tone": "Clean tone with no squeaks. Nice."
}
```

- [ ] **Step 1: Failing tests:** for a hail `Scores` whose largest losses are spacingMs (low), then fadeDb (low), then maxSqueakShare (high), `problems` equals those three texts in that order, with "{value}" replaced by "141". A perfect score gives `problems` = [] and a positive message. Every `(callType, key, dir)` that `targets.json` can produce resolves to some text (iterate the targets; dir in {low, high} where reachable: `lo` > 0 or `hi` < 999).
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Commit: `feat: coaching tip selection`.

### Task 14: Storage

**Files:**
- Create: `src/storage/db.ts`
- Test: `tests/storage/db.test.ts` (imports `fake-indexeddb/auto`)

**Interfaces:**
- Produces:

```ts
interface AttemptRecord { id: string; callType: CallType; createdAt: number; analyzerVersion: string;
  analysis: AnalysisResult; scores: Scores | null; tips: { problems: string[]; positive: string | null };
  audio: Blob; mimeType: string; durationMs: number; processingOff: boolean; targetSource: "builtin" | "reference" }
interface ReferenceRecord { id: string; callType: CallType; name: string; createdAt: number; audio: Blob;
  mimeType: string; measurements: CallMeasurements; notes: Note[]; active: boolean }
```

  - `openDb(name = "duck-call-coach"): Promise<IDBDatabase>`, version 1, stores `attempts` (keyPath `id`, index `callType`), `references` (keyPath `id`, index `callType`) and `settings` (keyPath `key`).
  - `saveAttempt(a)`, `getAttempt(id)`, `listAttempts(callType?)` (newest first), `deleteAttempt(id)`, `deleteAttemptsFor(callType)`, `deleteAll()`
  - `saveReference(r)`, `listReferences(callType)`, `setActiveReference(callType, id | null)` (at most one active per call type), `getActiveReference(callType)`, `deleteReference(id)`
  - `bestFlatness(callType): Promise<number | null>`: the flatness of the highest-scoring attempt with non-null measurements
  - `getSetting<T>(key): Promise<T | undefined>`, `setSetting(key, value)`
  - `requestPersistence(): Promise<boolean>` (wraps `navigator.storage?.persist`, false if unavailable) and `storageEstimate(): Promise<{ usage: number; quota: number } | null>`

- [ ] **Step 1: Failing tests:** save 3 attempts across 2 call types; `listAttempts("hail")` returns only hail, newest first. `deleteAttemptsFor("hail")` leaves the quack. Setting reference B active deactivates A for the same call type and leaves other call types alone. `bestFlatness` returns the flatness of the top-scoring attempt and null when there are no attempts. `deleteAll` empties attempts and references but keeps settings.
- [ ] **Step 2:** Run. FAIL. Implement (a small promise wrapper around IDB requests and transactions). Run. PASS.
- [ ] **Step 3:** Commit: `feat: IndexedDB storage for attempts, references and settings`.

### Task 15: Back up and restore

**Files:**
- Create: `src/storage/backup.ts`
- Test: `tests/storage/backup.test.ts`

**Interfaces:**
- Consumes: `db.ts`.
- Produces:
  - `exportBackup(): Promise<Blob>`: JSON `{ format: "duck-call-coach-backup", version: 1, exportedAt, attempts: [...], references: [...] }` with audio as base64 plus `mimeType`.
  - `class BackupError extends Error`
  - `parseBackup(text: string): BackupData`: validates everything before returning. Checks: the format and version strings; arrays; each record's id is a string of 1-64 chars; callType in the enum; numbers finite; `mimeType` starts with `"audio/"`; base64 decodes; each audio item <= 20 MB; total text <= 500 MB. The first failure throws `BackupError` with a plain message.
  - `importBackup(data: BackupData): Promise<{ added: number; skipped: number }>`: skips ids that already exist; writes all records in one transaction per store.

- [ ] **Step 1: Failing tests:** export then import into an empty DB gives identical records, with blobs byte-equal. Importing the same backup again gives `added 0`. **Review Focus 4:** each of these throws `BackupError` and leaves the DB unchanged: wrong `format`; `version: 2`; truncated JSON; an attempt with `callType: "goose"`; a `mimeType` of `"text/html"`; invalid base64; an `id` of 200 chars; `createdAt: "yesterday"`.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Commit: `feat: back up and restore with strict validation`.

### Task 16: App shell, Home and Practice screens

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/router.ts`, `src/ui/styles.css`, `src/ui/screens/home.ts`, `src/ui/screens/practice.ts`
- Modify: `src/ui/main.ts`, `index.html`
- Test: `tests/ui/router.test.ts`, `tests/ui/no-innerhtml.test.ts`

**Interfaces:**
- Consumes: `startRecording`, `AutoStop`, `analyzeInWorker`, `loadTargets`, `targetsFromReference`, `withFlatnessBaseline`, `scoreAttempt`, `selectTips`, `saveAttempt`, `getActiveReference`, `bestFlatness`, `liveResonanceHz`.
- Produces:
  - `el(tag: string, props?: Record<string, string>, ...children: (Node | string)[]): HTMLElement`: strings become text nodes.
  - `type Route = { name: "home" } | { name: "practice" | "history" | "references"; callType: CallType } | { name: "results"; id: string } | { name: "credits" }`, with `parseRoute(hash: string): Route` (unknown → home) and `routeHref(r: Route): string`.
  - `buildAttempt(...)` (in `practice.ts`, exported for reuse by Task 17): turns a `RecordingResult` plus `AnalysisResult` into an `AttemptRecord`. It picks the targets (the active reference via `targetsFromReference`, else built-in), applies `withFlatnessBaseline(reference flatness ?? bestFlatness)`, then scores and selects tips. When `quality` is non-null, `scores` is null and `tips` is empty.

- [ ] **Step 1: Failing tests:** `parseRoute("#/practice/hail")` gives `{name:"practice",callType:"hail"}`; `"#/practice/goose"` and `""` give home; `routeHref` round-trips every route. **Review Focus 5:** `no-innerhtml.test.ts` reads every `.ts` file under `src/` and fails if any contains `.innerHTML =`, `.outerHTML =` or `insertAdjacentHTML(`.
- [ ] **Step 2:** Run. FAIL. Implement `dom.ts` and `router.ts`. Run. PASS.
- [ ] **Step 3:** Implement Home (four tiles with last and best score from `listAttempts`, and links to History, References, Credits, Back up/Restore) and Practice (the description and confidence from targets, Play target, Record/Stop, a live level bar plus a resonance trace drawn on a canvas, AutoStop, then "Analyzing…", `buildAttempt`, `saveAttempt`, navigate to results). Error states: `NotAllowedError` shows the steps to allow the microphone in Chrome (lock icon → Permissions → Microphone → Allow); `NotSupportedError` shows "This browser can't record audio here. Use Chrome on Android or Safari on iPhone."; a worker failure keeps the recording, saves the attempt with `quality: null`, `scores: null` and an error note, and shows Retry analysis (which decodes the saved blob with `decodeAudioData`, mixes to mono and calls `analyzeInWorker` again). If `saveAttempt` rejects (for example storage full), still show the results from memory with "Couldn't save this attempt. Your phone may be out of space: back up and delete old attempts on the History screen."
- [ ] **Step 4:** Run `npm run build` and `npm test`. Expected: both pass. Manual check in desktop Chrome via `npm run dev`: record from the laptop mic and land on the results route.
- [ ] **Step 5:** Commit: `feat: app shell, home and practice screens`.

### Task 17: Results screen and notes chart

**Files:**
- Create: `src/ui/screens/results.ts`, `src/ui/charts/notesChart.ts`, `src/ui/charts/targetShape.ts`
- Test: `tests/ui/targetShape.test.ts`, `tests/ui/notesChart.test.ts`

**Interfaces:**
- Produces:
  - `interface ShapeNote { startS: number; durationMs: number; levelDb: number }`
  - `builtInShape(t: CallTargets): ShapeNote[]`: hail/comeback use the midpoint note count (hail 6, comeback 7), mid spacing, first note 250 ms (comeback 200) shrinking linearly to ratio 0.5, and levels fading 8 dB from note 2. Quack is one note of 280 ms. Chuckle is 3 bursts of 4 notes, 60 ms long, mid burst spacing, 400 ms between bursts.
  - `referenceShape(ref: Note[]): ShapeNote[]`
  - `interface Rect { x: number; y: number; w: number; h: number; unmatched: boolean }`
  - `notesChartGeometry(attempt: Note[], target: ShapeNote[], width: number, height: number, pairs?: Array<[number | null, number | null]>): { attempt: Rect[]; target: Rect[] }`: x = time, height = level above (max − 40 dB), both series sharing one time axis starting at each series' first onset. In reference mode `pairs` comes from `pairNotes`, and notes paired with null get `unmatched: true` (drawn in a warning color: an extra note of yours, or a reference note you missed). Rendered as SVG by `renderNotesChart(...)`.
- Results screen: overall score; four sub-scores (null shown as "–"); the chart; problems then positive; a confidence badge; **Play mine** (object URL of the stored blob, revoked on leave); **Play target** (active reference, else `clips/<callType>.mp3`, where comeback uses `hail.mp3` labeled "Hen hail: a comeback is a faster, more urgent version"); **Try again**; **Delete**. For a quality issue, show only the matching message instead of scores: clipped "Too loud. Hold the phone further from the call."; too_quiet "Too quiet or too noisy to judge. Get closer or find a quieter spot."; no_notes "Didn't hear a call."; too_few_notes "Didn't hear a full call. Try the whole call." When `processingOff` is false, add "Your phone may be cleaning up the sound, so tone scores are less reliable."

- [ ] **Step 1: Failing tests:** `builtInShape(hail)` has 6 notes, first 250 ms, last 125 ms, spacing 300 ms, and the last note 8 dB below the first. `notesChartGeometry` maps the loudest note to full height and the first onset to x = 0, and no rect has a negative size. With `pairs` containing `[null, 2]` and `[4, null]`, target rect 2 and attempt rect 4 are `unmatched` and no other rect is.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Implement `results.ts`. Run `npm run build`. Manual check in desktop Chrome: a recorded attempt shows scores, the chart and tips, and a silent recording shows "Didn't hear a call."
- [ ] **Step 4:** Commit: `feat: results screen with notes chart and tips`.

### Task 18: History screen and backup UI

**Files:**
- Create: `src/ui/screens/history.ts`, `src/ui/charts/historyChart.ts`
- Test: `tests/ui/historyChart.test.ts`

**Interfaces:**
- Produces: `historyChartGeometry(points: { t: number; score: number }[], width: number, height: number): { x: number; y: number }[]` (y = 0 at score 100; a single point is centered on x).
- History screen: a call-type switcher; the score-over-time chart (only scored attempts); the attempt list (date, score or "not judged") linking to results; "Delete all for this call" with confirmation; storage use from `storageEstimate`, with a warning banner (also on Home) when usage exceeds 90% of quota. The Back up / Restore section (shown on the History screen): Back up downloads `duck-call-coach-backup-YYYY-MM-DD.json` via an object URL and `<a download>`; Restore uses a file input → `parseBackup` → `importBackup`, showing "Added N, skipped M" or the `BackupError` message; "Delete everything" with typed confirmation (the user types DELETE).

- [ ] **Step 1: Failing tests:** three points with scores 0, 50 and 100 map to y = height, height/2 and 0, with x increasing in time order. An empty list gives [].
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Implement `history.ts` and the backup UI. Build. Manual check: back up, delete everything, restore, and the history returns.
- [ ] **Step 4:** Commit: `feat: history, progress chart and backup UI`.

### Task 19: References and Credits screens

**Files:**
- Create: `src/ui/screens/references.ts`, `src/ui/screens/credits.ts`
- Test: `tests/ui/importAudio.test.ts`

**Interfaces:**
- Produces: `checkImportFile(file: { size: number; type: string; name: string }): string | null`, which returns an error message for size > 20 MB ("That file is over 20 MB.") or a non-audio type ("That isn't an audio file."), else null.
- References screen per call type: list (name, date, Active badge), Record new (same capture flow, named via a text input, max 60 chars, trimmed), Import (file input, `accept="audio/*"`, `checkImportFile`, `decodeAudioData` → mono mix → `analyze`; reject with the analysis quality message if it is non-null), Set active / Use built-in target, Delete.
- Credits screen: generated from a `credits` array in `credits.ts` mirroring `CREDITS.md` (XC number, recordist, license, link).

- [ ] **Step 1: Failing tests:** 21 MB → the size message; `type: "text/plain"` → the type message; a 2 MB `audio/mpeg` → null.
- [ ] **Step 2:** Run. FAIL. Implement. Run. PASS.
- [ ] **Step 3:** Implement both screens. Build. Manual check in desktop Chrome: import `public/clips/hail.mp3` as a hail reference, set it active, record, and the results show "Target: your reference" with the reference's shape in the chart. Then push to `main` and have the user run the same flow plus one practice attempt per call type on their Android phone.
- [ ] **Step 4:** Commit: `feat: references and credits screens`.

### Task 20: Offline, install and persistence

**Files:**
- Create: `src/sw-template.js`, `public/manifest.webmanifest`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `vite.config.ts` (an `sw` plugin), `index.html`, `src/ui/main.ts`, `scripts/make_assets.py` (icon generation with Pillow)
- Test: `tests/build/sw.test.ts`

**Interfaces:**
- Produces: a build plugin (`apply: "build"`, `generateBundle`) that emits `sw.js` from `sw-template.js`, replacing `__VERSION__` with a hash of all emitted file names and `__ASSETS__` with a JSON array of every emitted file plus `clips/*.mp3`, `icons/*` and `manifest.webmanifest`. The service worker precaches the assets on install, deletes old caches on activate, serves navigation requests network-first with a cached `index.html` fallback, and serves other same-origin GETs cache-first.
- Manifest: name "Duck Call Coach", short_name "Duck Coach", `start_url` and `scope` `"/duck-call-coach/"`, `display: "standalone"`, theme and background colors from `styles.css`, and the two icons (one also `"purpose": "maskable"`).
- `main.ts`: registers `sw.js` in production; on first run calls `requestPersistence()`; listens for `beforeinstallprompt` and shows an "Add to Home Screen" button on Home until dismissed (saved in settings). On iPhone (no prompt), it shows a one-line instruction ("Share → Add to Home Screen") once.

- [ ] **Step 1: Failing test** `sw.test.ts`: run Vite's `build()` programmatically to a temp dir. The output contains `sw.js` with no `__ASSETS__`/`__VERSION__` left, whose asset list includes `index.html`, `clips/hail.mp3` and the hashed main JS file name.
- [ ] **Step 2:** Run. FAIL. Implement the plugin, template, manifest and icons. Run. PASS.
- [ ] **Step 3:** Push to `main` (the deploy runs). On the user's Android phone: install from the Add to Home Screen button, open the installed app, turn on airplane mode, relaunch. Expected: the app loads, recording and analysis work, and history is intact.
- [ ] **Step 4:** Commit: `feat: offline service worker, manifest and install prompt`.

### Task 21: Tuning round (Milestone 7, with the user)

**Files:**
- Modify (as findings require): `src/scoring/targets.json`, `src/scoring/tips.json`, `src/config/analysis.ts`, `docs/research/2026-10-15-hen-mallard-measurements.md`

- [ ] **Step 1:** The user records about 10 ordinary attempts per call type over a few sessions, then exports a Back up and shares the file.
- [ ] **Step 2:** Load the backup in a throwaway Node script that runs `analyze` on every attempt and prints measurements next to the scores and tips.
- [ ] **Step 3:** With the user, list cases where a tip was wrong or missing. Adjust only targets, tips or parameters, each with a one-line reason in the research doc. Any `src/config/analysis.ts` change must keep Tasks 8 and 9 green. Bump `ANALYZER_VERSION` to `1.1.0` if any analysis parameter changed.
- [ ] **Step 4:** Decide with the user whether the crack or tone measures are worth adding as a follow-up spec.
- [ ] **Step 5:** Commit: `tune: adjust targets and tips from first real attempts`.
