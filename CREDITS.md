# Credits

The hen recordings bundled with Duck Call Coach come from [xeno-canto](https://xeno-canto.org).
Each one has been trimmed, and the bundled clips were also converted to mono and
normalized in level. All are licensed for non-commercial use with attribution and
share-alike (CC BY-NC-SA), so the trimmed clips are shared under the same license.

| Recording | Recordist | License | Used for |
|---|---|---|---|
| [XC964309](https://xeno-canto.org/964309) | Thomas G. Graves | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | Clips `hail.mp3` (99.3-102.1 s) and `chuckle.mp3` (23.5-29.5 s); test fixtures `hail_a.wav`, `chuckle_a.wav` |
| [XC692779](https://xeno-canto.org/692779) | Barry Edmonston | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | Clip `quack.mp3` (2.4-4.0 s); test fixture `steady_quacks.wav` (2.4-12.0 s) |
| [XC11494](https://xeno-canto.org/11494) | Allen T. Chartier | [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) | Test fixture `quacks_4.wav` (5.1-6.7 s) |
| [XC840246](https://xeno-canto.org/840246) | Jorge Leitão | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | Test fixture `hail_b.wav` (2.9-4.6 s) |

## Recordings not used

[XC196999](https://xeno-canto.org/196999) (Herman van der Meer) is licensed
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). The no-derivatives
term forbids trimmed excerpts, so it is not bundled and has no test fixture.

## Where the files live

- `public/clips/` is the audio played in the app as "what a real hen sounds like".
- `tests/fixtures/` holds trimmed 16-bit WAV excerpts used only by the automated tests.
  They are not shipped in the app.
- `scripts/make_assets.py` regenerates both from the original downloads.
