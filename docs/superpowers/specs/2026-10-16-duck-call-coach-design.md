# Duck Call Coach: Design

Date: 2026-10-16
Status: draft for review
Research: [docs/research/2026-10-15-hen-mallard-measurements.md](../../research/2026-10-15-hen-mallard-measurements.md)

## 1. Goal

A phone app that listens to the user practice a mallard duck call and tells them what to
change to sound more like a real hen. The user is a beginner and a hunter: "better" means
"more like a real hen mallard", not contest style.

Success looks like:
- The user records an attempt and within a couple of seconds sees a score, a chart of the
  attempt against the target, and 2-3 concrete tips plus one thing they did well.
- The tips point at real, measurable problems (rushing, too many notes, no fade, squeaking,
  pitch too high) and the app says so honestly when it cannot judge an attempt.
- The user can see whether they are improving over weeks.

### Decisions already made

| Topic | Decision |
|---|---|
| Platform | Web app (PWA), added to the home screen. Primary device: the user's Android phone (Chrome). Should also run on iPhone Safari, but Android is tuned and tested first. |
| Analysis | On the phone, by signal measurement and rules. No server, no AI service, works offline. |
| What "good" means | Built-in targets from real hen recordings, plus optional user-loaded reference recordings. |
| Calls coached | Basic quack, greeting/hail, feed chuckle, comeback. |
| History | Scores and recordings saved on the phone, with a progress chart. |
| Goal | Hunting realism. |

### Non-goals (version 1)

- No accounts, cloud sync, sharing, or social features.
- No contest-style judging.
- No scoring of the high-to-low "crack", a honky or nasal tone, or air control. These could
  not be tested without real human calls (see section 14). They may be added after tuning
  with the user's own recordings.
- No other duck species or goose calls.

## 2. Screens and flow

1. **Home.** Four tiles (Quack, Greeting/Hail, Feed Chuckle, Comeback), each showing last and
   best score. Links to History, References, Credits, and Back up / Restore. First run shows
   an "Add to Home Screen" prompt.
2. **Practice.** A one-line description of the target ("Hail: 5-6 notes, each shorter and
   softer, steady pace"), a **Play target** button (the user's reference if one is active,
   otherwise a bundled real hen clip), and one big **Record** button. While recording: a live
   level meter and a scrolling resonance line. Recording stops on tap, after 1.5 s of silence
   following at least one note, or at 15 s.
3. **Results.** Overall score 0-100; four sub-scores (Rhythm, Notes, Pitch, Tone); a chart of
   the attempt's notes (time vs level, with resonance) drawn over the target's shape; 2-3
   tips, biggest problem first, plus one positive; buttons **Play mine**, **Play target**,
   **Try again**. Each target shows its confidence level (High / Medium / Low). Attempts save
   automatically and can be deleted. If the attempt could not be judged, the screen says why
   instead of showing a score.
4. **History.** Per call type: a score-over-time chart and a list of attempts (date, score).
   Tapping one reopens its Results screen and playback.
5. **References.** Per call type: record a reference or import an audio file from the phone,
   name it, set it active, or switch back to the built-in target. Delete references.
6. **Credits.** Recordists and licenses of the bundled hen clips.

## 3. Audio capture

- `getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1}})`.
  After capture starts, read `track.getSettings()` and record whether the browser actually
  honored each setting. Milestone 1 verifies this on the user's phone.
- Two parallel paths from the same stream:
  - **AudioWorklet** collects raw Float32 PCM at the device rate (usually 48 kHz) for analysis.
    It is discarded after analysis.
  - **MediaRecorder** produces the compressed copy that is stored for playback
    (`audio/webm;codecs=opus` on Android Chrome; `audio/mp4` fallback on Safari).
- An AnalyserNode drives the live meter and resonance line.
- Clipping check: if more than 0.5% of samples are at or above 0.99 of full scale, the attempt
  is "too loud, hold the phone further away" and is not scored.

## 4. Analysis pipeline

All analysis runs in a Web Worker on the raw PCM. Every numeric parameter below lives in one
config module so it can be tuned in one place.

1. **High-pass filter** at 200 Hz (4th-order Butterworth, run forward and backward), which
   removes wind and handling rumble.
2. **Frames:** 40 ms windows, 10 ms hop. Per frame: RMS level in dB.
3. **Noise floor:** 10th percentile of frame levels.
4. **Note finding:**
   1. Note on above floor + 12 dB, off below floor + 8 dB.
   2. Merge gaps shorter than 25 ms. Drop notes shorter than 30 ms.
   3. **Dip split:** inside a loud region, start a new note at a valley at least 6 dB below
      the peak before it and the next peak within 250 ms.
   4. **Echo-tail merge:** a blip of 100 ms or less, starting less than 120 ms after a note
      and at least 12 dB quieter than it, belongs to that note.
   5. **Peak-relative edges:** a note's start and end are where its level is within 18 dB of
      that note's own peak. Note lengths are reported from these edges, not from the
      floor-based on/off (which varied 150 vs 230 ms on the same hail in research).
5. **Per-note measurements:**
   - Length, onset, peak level.
   - **Resonance:** frequency of the maximum of the 150 Hz-smoothed log spectrum between
     800 and 4000 Hz. This is the main "pitch" measure.
   - **Fundamental (informational only):** autocorrelation of the detrended log spectrum in
     1-4 kHz, lags 100-700 Hz. Reported only when correlation strength is 0.25 or more.
     Never scored.
   - **Squeak share:** in 30 ms slices (15 ms hop), the share of the slice's 0.3-6 kHz energy
     that sits inside one +-150 Hz window above 2.6 kHz; the note's value is the maximum over
     slices. Notes more than 20 dB below the loudest note are skipped.
   - **Flatness (rasp):** spectral flatness over 0.3-6 kHz.
6. **Sequence building:** notes separated by more than 0.6 s of silence start a new sequence.
   The scored sequence is the one with the most notes (ties: the loudest). For the quack,
   the scored note is the loudest note.
7. **Call-level measurements:** note count; mean spacing (onset to onset) and its coefficient
   of variation; first and last note length and their ratio; index of the loudest note; fade
   (loudest note level minus last note level); median spacing within bursts (gaps under
   0.25 s; used for the chuckle); median resonance and its slope per note;
   median flatness; maximum squeak share; signal-to-noise (loudest note peak minus floor).
8. **Quality gate.** Do not score, and say why, when:
   - signal-to-noise is under 15 dB ("too quiet or too noisy, get closer or find a quieter spot"),
   - clipping (section 3),
   - no notes found, or a hail, comeback or chuckle has fewer than 3 notes ("didn't hear a full call").

## 5. Targets

Targets live in `targets.json`, one entry per call type. Each measure has a target range
`[lo, hi]`, a tolerance (how far outside the range the score reaches 0), a weight, and the
sub-score it belongs to. Starting values come from the research:

| Call | Measure | Target | Sub-score | Confidence |
|---|---|---|---|---|
| Quack | Note length | 180-375 ms | Notes | High |
| | Resonance | 1.8-2.1 kHz | Pitch | High |
| | Squeak share | below 0.8 | Tone | Medium |
| Hail | Note count | 4-10 (5-6 shown as ideal) | Notes | High |
| | Spacing | 230-370 ms | Rhythm | High |
| | Spacing CV | at most 0.15 | Rhythm | High |
| | Last/first note length | 0.3-0.7 | Notes | Medium |
| | Loudest note | among notes 1-4 | Notes | Medium |
| | Fade | at least 4 dB | Notes | Medium |
| | Resonance | 1.5-2.4 kHz, slope -60 to +10 Hz/note | Pitch | Medium |
| | Squeak share | below 0.8 | Tone | Medium |
| Comeback | Note count | 5-10 | Notes | Low |
| | Spacing | 150-250 ms | Rhythm | Low |
| | Spacing CV | at most 0.2 | Rhythm | Low |
| | Loudest note | note 1 or 2 | Notes | Low |
| | Fade | at least 4 dB | Notes | Low |
| | Resonance, squeak | as hail | Pitch, Tone | Low |
| Feed chuckle | Note length | 30-100 ms | Notes | Low |
| | Spacing within a burst (median) | 100-165 ms (6-10 notes per s) | Rhythm | Low |
| | Quack-length notes (over 150 ms) | none | Notes | Low |

**Rasp (flatness)** is never scored against a fixed number, because hens range from 0.036 to
0.106. It is scored only against the active reference or against the user's own best-scoring
attempt for that call type (within +-40% scores 100). With neither available, the Tone
sub-score uses squeak only.

**Reference mode.** When a reference is active for a call type, its measurements replace the
built-in ranges: spacing +-15%, note count +-1, resonance +-150 Hz, note length +-20%,
fade +-4 dB, flatness +-40%. Notes are paired with dynamic time warping over per-note features
(normalized onset, length, relative level, resonance), so one missed note does not shift every
comparison after it. The Results chart then draws the reference's notes as the target shape.

## 6. Scoring

- Each measure scores 100 inside its range, falling linearly to 0 at the tolerance distance
  outside it.
- Sub-score = weighted mean of its measures. Overall = weighted mean of sub-scores, with
  per-call weights in `targets.json`: Chuckle weights Rhythm highest, Hail weights Notes
  highest, Quack weights Pitch and Tone highest.
- Scores are stored with an `analyzerVersion` so later tuning can be told apart in History.

## 7. Coaching tips

- Tips live in `tips.json`, keyed by measure and direction (for example
  `hail.spacing.tooShort`), each with the message template and the numbers to fill in:
  *"Your notes are {value} ms apart; a hen's are {lo}-{hi}. Slow down and give each note its
  own 'quack'."*
- The Results screen shows the 2-3 measures with the largest weighted score loss, plus one
  positive message from the best-scoring sub-score.
- The tip text describes what to try in general calling terms; it is not expert-reviewed.
  Because it is a plain file, the user or a calling buddy can rewrite it without touching code.

## 8. Storage

IndexedDB on the phone, with no uploads.

| Store | Fields |
|---|---|
| `attempts` | id, callType, createdAt, analyzerVersion, scores, measurements, tips shown, audio Blob, mimeType, durationMs |
| `references` | id, callType, name, createdAt, audio Blob, mimeType, measurements, active |
| `settings` | key/value (for example: install prompt dismissed) |

- On first run, call `navigator.storage.persist()`, which installed PWAs on Android Chrome are
  normally granted. Show storage use on the History screen.
- **Back up** writes one JSON file (records plus base64 audio) through the browser's download.
  **Restore** reads it back, skipping records that already exist. iPhone users need this
  most, because Safari may clear data for sites not on the home screen.
- Delete one attempt, all attempts for a call type, or everything (with confirmation).
- Raw PCM is never stored. Re-analysis after tuning decodes the stored compressed audio.

## 9. Hosting and app shell

- Static site on **GitHub Pages** over HTTPS, which the microphone requires. The repository is
  public; it contains no secrets, and recordings never leave the phone. (Cloudflare Pages is
  the alternative if the user wants the code private.)
- Web app manifest plus a small hand-written service worker that caches the app shell and
  bundled clips, so the app works offline after the first load. A new deploy is picked up on
  the next launch.
- Content Security Policy restricted to `'self'`; no third-party scripts, analytics, or CDNs.

## 10. Architecture

TypeScript, built with Vite, no UI framework. Small hand-drawn SVG charts (no chart library).
Runtime dependencies: none planned. Dev dependencies: Vite, TypeScript, Vitest.

| Module | Responsibility | Depends on |
|---|---|---|
| `capture/` | Mic setup with processing off, AudioWorklet PCM, MediaRecorder, live meter, auto-stop, clipping check | browser audio APIs |
| `analysis/` | Pure functions: filter, frames, note finding, per-note and call-level measurements, quality gate. Runs in a Web Worker. | nothing (pure) |
| `scoring/` | Load `targets.json` and `tips.json`, score measurements, reference-mode ranges, DTW pairing, tip selection | `analysis` types |
| `storage/` | IndexedDB access, persistence request, back up / restore | browser IndexedDB |
| `ui/` | Screens, charts, playback | all of the above |
| `assets/` | Bundled hen clips, credits data | |

`analysis` and `scoring` have no browser dependencies, so they run and are tested in Node.

## 11. Error handling

| Situation | Behavior |
|---|---|
| Mic permission denied | Explain how to allow the microphone in Chrome site settings; Record stays disabled until granted. |
| Browser lacks AudioWorklet or MediaRecorder | Show "this browser isn't supported" with the browsers that are. |
| Phone ignores the "processing off" request | Note it on the Results screen ("your phone may be cleaning up the sound; tone scores are less reliable") and record it with the attempt. |
| Too quiet, too noisy, clipped, or too few notes | "Couldn't judge this one" plus the reason; the attempt is saved without a score. |
| Analysis throws | Keep the recording, show an error with a retry, never fail silently. |
| Storage nearly full or a write fails | Warn and point to Back up; never drop the current attempt without telling the user. |
| Imported reference file can't be decoded, or is over 20 MB | Say so and keep the previous reference. |
| Restore file invalid | Validate the structure and types before writing anything; reject the whole file with a message. |

## 12. Testing

- **Analysis golden tests.** Port the research measurements as fixtures: note count, spacing,
  lengths, fade, and resonance for the hand-picked hen hails and steady-quack runs. The
  TypeScript implementation must match within stated tolerances (for example spacing +-10 ms,
  resonance +-60 Hz).
- **Planted-mistake tests.** Port `synth_test.py`: for each fixture hail, generate rushed,
  dragging, uneven, no-fade, too-many-notes, squeak, too-raspy and pitch-high versions and
  assert the matching measure moves past its target boundary. These guard detection against
  regressions during tuning.
- **Scoring tests.** Range edges, tolerance fall-off, weighting, reference-mode ranges, tip
  selection order, quality-gate cases.
- **Storage tests.** Back up and restore round-trip, and restore rejects malformed files.
- **On-device checks (manual, user's Android phone).** Milestone 1 recorder; then every
  milestone gets a short checklist run on the phone.
- Test fixtures use only recordings whose license allows redistribution with attribution
  (CC BY-NC-SA: XC964309, XC692779, XC11494, verified). Credits ship in the repo and the app.

## 13. Milestones

1. **Phone recorder spike.** Deploy a bare page to GitHub Pages that records with processing
   off, reports `getSettings()`, shows the level meter and a spectrum, and plays back. Run it
   on the user's Android phone. Gate: processing is really off, or we adapt before building more.
2. **Analysis core.** The TypeScript port of section 4, with golden and planted-mistake tests passing.
3. **Scoring and tips.** `targets.json`, `tips.json`, the scoring module, and the Practice and
   Results screens using built-in targets.
4. **History and storage.** Attempts saved, History chart and list, back up / restore, delete.
5. **References.** Record or import, DTW comparison, bundled hen clips for Play target, Credits.
6. **Offline and install.** Manifest, service worker, install prompt, persistence request.
7. **Tuning round.** The user records ordinary attempts; adjust thresholds, tip wording and
   the low-confidence targets; decide whether the crack or tone measures earn a place.

## 14. Risks and open questions

- **Phone audio processing.** Some phones keep processing despite the constraints. Milestone 1
  exists to find this out first.
- **Low-confidence targets.** Chuckle and comeback targets rest on one hen recording or are
  derived from the hail. They are labeled Low in the app and are first in line for tuning.
- **Tips are not expert-reviewed.** Measurements say *what* is off; the "what to try" advice is
  general calling knowledge.
- **Rasp is relative only**, and the crack, honky tone and air control are not scored in v1.
- **Licensing.** Bundled clips are CC BY-NC-SA: fine for this personal, non-commercial app with
  credit. Selling the app would require replacing them.
