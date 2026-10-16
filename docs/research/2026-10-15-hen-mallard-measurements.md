# Hen mallard call measurements (research for the duck call coach)

Date: 2026-10-15. Throwaway analysis; numbers are starting targets to be re-tuned
against real phone recordings of the user's calling.

## Sources

Published:
- Birds of the World, Mallard "Sounds and Vocal Behavior": decrescendo (hail) call is
  2-10 notes, accent on note 1 or 2, notes decrease in amplitude, frequency range and
  duration; modal note length 250 ms. Alarm quack is a single ~400 ms "quaaack".
- Callicutt et al. 2013, Wildlife Society Bulletin, doi:10.1002/wsb.228 (and the 2010
  MSU thesis): 38 wild hens vs 38 human callers. 5 notes was the most common decrescendo
  length (42% of hens). Callers were compared on entropy (rasp), pitch, pitch goodness,
  frequency modulation and notes per second. Double-reed calls were closer to hens,
  attributed to their raspier notes. Full numbers are paywalled; the thesis PDF is behind
  a Cloudflare bot check and was not retrieved.
- Ducks Unlimited summary of the same study: typical decrescendo is 5-6 notes, one or
  two loud quacks then progressively shorter, softer quacks.
- Calling guides: feed chuckle is bursts of 3-5 staccato notes; comeback is a louder,
  faster, more urgent hail (a hunter's call, not a distinct hen vocalization).

Recordings analyzed (xeno-canto, all CC BY-NC-SA, credit the recordist):
- XC964309, Thomas G. Graves, California 2025, iPhone 11 + Rode VideoMic ME, 48 kHz WAV.
  Hen long calls at 0:52 and 1:39, chuckles at 0:22 and 3:03.
- XC692779, Barry Edmonston, Vancouver Island 2021. One hen, ~64 persistent quacks.
- XC11494, Allen T. Chartier, Michigan 2007. Four loud quacks from one hen.

## Key finding: what "pitch" means for a quack

A hen quack is not a clean tone. It has:
1. A low fundamental (reed/syrinx pitch), roughly 180-400 Hz, visible as harmonic lines
   but weak and hard to track. Plain pitch trackers (YIN) jump between it and its
   harmonics, giving readings anywhere from 200 to 2,400 Hz for the same quack.
2. A strong resonance band where most of the energy sits, centered at 1.7-2.3 kHz.
   This is stable and measurable on every note.

Design consequence: score "pitch" mainly on the resonance-band center and how it moves
across the call, and use the fundamental only when harmonic spacing is detected with
confidence.

## Measurements

| Call | Notes | Note length | Note spacing (onset to onset) | Evenness (CV of spacing) | Resonance center | Trend across call |
|---|---|---|---|---|---|---|
| Single quacks (XC11494) | 4 | 220-260 ms | ~370 ms | 0.06 | 1.66-2.06 kHz | flat |
| Persistent quacking (XC692779) | 64 | mostly 170-300 ms, typical ~200-280 | ~510 ms (2 per s) | 0.17 | 2.0-2.15 kHz (fundamental ~355 Hz, very consistent) | flat |
| Hail / decrescendo (XC964309 @1:39) | 9 | 150 ms falling to ~100-110 ms | ~235 ms (4.3 per s) | 0.05 | 2.26 kHz falling to 1.91 kHz | resonance -45 Hz/note, length -6 ms/note, loudest at note 4, then fades ~5 dB by the last note |
| Hail, two hens overlapping (XC964309 @0:59) | 7 | 140-360 ms | ~330 ms | 0.25 | 2.0 kHz falling to 1.8 kHz | falling, fading; noisy because of the overlap |
| Feed chuckle (XC964309 @0:23 and 3:03) | 20+ | 30-100 ms (typical ~60), clicks of 20-40 ms when distant | ~100-130 ms within a burst; bursts of 2-5 separated by 300-500 ms | irregular overall (0.66), regular within a burst | 1.2-2.0 kHz, lower and noisier than quacks | none; essentially unvoiced |

Tone (on these recordings, field mics, partly MP3):
- Clean persistent quack: aperiodicity ~0.25-0.30, spectral flatness ~0.005.
- Loud hail notes: aperiodicity ~0.33-0.45, flatness ~0.06-0.10 (raspier as intensity rises).
- Chuckle notes: aperiodicity 0.6+, largely noise.
Absolute tone thresholds will need re-tuning on the user's phone.

## Detection lessons

- Splitting notes only on silence fails on fast calls and overlapping or echoing sound.
  Also split at volume valleys at least 6 dB below the neighboring peaks.
- A 200 Hz high-pass removes wind and handling rumble without touching the call.
- Distant, quiet chatter (XC964309 @3:03) falls under a "noise floor + 12 dB" threshold.
  Practice recordings at arm's length should be far louder, but the app should warn
  when the call is less than ~15 dB above the background.

## Round 2: 30 hen recordings (2026-10-15)

Added 27 xeno-canto recordings: every A-quality female mallard recording typed as call,
alarm call or uncertain and longer than ~10 s (XC1163518, 1142977, 1092629, 840246, 805337,
799596, 634248, 603723, 600591, 591751, 591701, 556906, 541823, 541822, 541821, 541812,
512909, 396538, 394595, 394594, 394593, 391162, 298011, 196999, 196990, 169506, 131689).
Licenses vary per recording (CC BY-NC-SA / BY-NC-ND); fine for analysis, check each one
before bundling any clip in the app.

An automatic "hail-shaped" filter flagged 37 sequences; by eye on spectrograms only about a
third were real hen hails. False positives were songbirds over quacks, lone quacks plus
clicks, and long steady quacking runs. The app must not assume its input is clean either.

### Steady quacking (basis for the single-quack target), 8 clean single-hen runs

XC1092629, XC391162, XC541823, XC634248, XC692779, XC591751, XC556906, XC591701:

| Measure | Range across hens |
|---|---|
| Quack length (median per hen) | 180-375 ms |
| Spacing between quacks | 400-640 ms |
| Resonance center (median per hen) | 1.80-2.08 kHz, remarkably consistent |
| Fundamental (when confidently detected) | 230-390 Hz, mostly 330-390 |

Runs reading resonance at 3+ kHz were contaminated by other birds (Estonian recordings).

### Hails, hand-picked

Classic hails (4 clear examples: XC964309 @99.6 s, XC840246 @3.2 s, XC196999 @1.1 s,
XC541822 @0.6 s), together with the published data:

| Measure | Hen range | Notes |
|---|---|---|
| Notes | 4-10 here; 2-10 published, 5 most common | |
| Spacing | 230-370 ms (2.7-4.3 notes per s) | |
| Evenness (CV of spacing) | 0.02-0.14 | hens are very steady |
| First note | 170-370 ms | |
| Last note | 90-160 ms, 0.3-0.7x the first | |
| Loudest note | 1st-4th | published says 1st or 2nd |
| Fade, loudest to last | 5-26 dB | gentle in XC964309, steep in XC196999 |
| Resonance | 1.5-2.4 kHz, drifting down 0-250 Hz over the call | |

A second, faster pattern also shows up (XC1163518, four examples): 3-5 notes, 80-160 ms long,
160-210 ms apart, loudest in the middle. Treat this as a hen variation, not an error.
XC600591 has a much lower resonance (~1.3 kHz) with alternating loud and quiet notes:
possibly a domestic-type bird or a recording artifact. Excluded.

## Planted-mistake test

Mistakes were planted by computer into 3 real hails (A = XC964309, B = XC840246,
C = XC196999), then measured. Script: synth_test.py (throwaway).

| Planted mistake | Measure | Clean (A / B / C) | With mistake (A / B / C) | Caught? |
|---|---|---|---|---|
| Rushed (spacing and notes x0.6) | spacing ms | 235 / 350 / 370 | 141 / 210 / 218 | yes, all 3 |
| Dragging (spacing x1.6) | spacing ms | 235 / 350 / 370 | 376 / 560 / 592 | yes, all 3 |
| Uneven rhythm (+-45% random) | CV | 0.04 / 0.10 / 0.13 | 0.27 / 0.18 / 0.50 | yes on A and C; B is borderline |
| No fade (notes equalized) | fade dB | 4.8 / 7.7 / 25.8 | 2.9 / 0.8 / 3.1 | yes, but A's clean fade is already gentle |
| Too many notes | count | 9 / 4 / 6 | 23 / 8 / 16 | yes, all 3 |
| Squeak (80 ms high chirp on note 1) | squeak share | 0.21 / 0.12 / 0.63 | 0.98 / 0.98 / 1.00 | yes; C's baseline is high from a faint high note |
| Too raspy (noise added) | flatness | 0.106 / 0.036 / 0.101 | 0.129 / 0.072 / 0.149 | only relative to the same call; no absolute cut-off works across hens |
| Pitch too high (+30%) | resonance Hz | 1945 / 1821 / 1873 | 2534 / 2366 / 2422 | yes, all 3 (above the hen range) |

Not tested, because it can't be planted credibly: a missing high-to-low "crack", a honky or
nasal tone, hard or mushy note starts, weak air support. These need real human recordings.

## Detection fixes found by the test

- Echo tails: a blip <= 100 ms, starting < 120 ms after a note and >= 12 dB quieter, belongs to
  that note. Without the length limit, the rule also swallows real quiet hail notes.
- Note length depends on the threshold: the same hail read 150 ms per note against a local
  noise floor and 230 ms against a whole-file floor. Measure each note relative to its own
  peak (e.g. where it falls 15-20 dB below the peak), not relative to the background.
- Squeak: check 30 ms slices for a narrow (+-150 Hz) peak above 2.6 kHz holding a large share
  of the slice's total energy. Whole-note measures dilute a short squeak. Ignore notes more
  than ~20 dB below the loudest note, which carry stray high sounds.
- Rasp: score it against the user's own reference or best attempt, or as a trend over
  sessions, not against a fixed number.

## TypeScript port: golden-test notes (2026-10-16)

- The quack-mode golden test moved from `quacks_4.wav` to `steady_quacks.wav` analysed as a quack (expect 1 note, first note 170-340 ms, resonance 1800-2150 Hz).
- `quacks_4.wav` is a 1.6 s clip packed with calls over a background flock. Its own 10th-percentile floor is -19.96 dB, against -25.7 dB for the full research recording. Against that floor the analyzer finds 3 notes (onsets 0.22 / 0.57 / 0.97 s, 140-190 ms), and the loudest peaks only 12.7 dB above the floor, so the recording reads as `too_quiet`. With the research floor the same code reproduces the 4 research notes (0.15 / 0.52 / 0.92 / 1.27 s, 220-260 ms).
- The first note scored in `steady_quacks.wav` as a quack is 170 ms, exactly on the lower bound of that test and just under the 180-375 ms built-in quack target.
- Product risk for the tuning round: dense recordings raise the floor. A user who quacks over and over into a short recording raises their own percentile floor, which shortens the notes and can fail the 15 dB SNR gate.
- Measured: hail_a 9 notes, 235 ms spacing, CV 0.037, 1945 Hz, fade 4.8 dB, squeak 0.21; steady_quacks (hail) 19 notes, 507 ms; steady_quacks (quack) 170 ms, 2005 Hz; chuckle_a 16 notes, median 70 ms, burst 130 ms; hail_b 4 notes, 350 ms; quacks_4 (quack) too_quiet, 140 ms, 1884 Hz.
