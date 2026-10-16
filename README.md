# Duck Call Coach

A phone app that listens to you blow a mallard duck call and coaches you. You pick a call (quack, hail call,
comeback or feed chuckle), tap Record, and it scores your rhythm, notes, pitch and tone against a real hen,
then gives you up to three plain-English tips on what to fix.

It runs in the phone's browser, works offline once installed, and needs no account.

**Live app:** https://jamesbaptista.github.io/duck-call-coach/

## Install it on your Android phone

1. Open the link above in **Chrome**.
2. Tap the **Add to Home Screen** button on the app's Home screen (or Chrome's ⋮ menu → **Add to Home screen**).
3. Open it from the new icon. From then on it works without a connection.

On an iPhone, open the link in Safari and tap Share → Add to Home Screen.

## First run: check your phone's microphone

Phones often "clean up" the microphone for phone calls, which changes how a duck call sounds. Before you trust the
scores, do this once:

1. Open the mic check page: https://jamesbaptista.github.io/duck-call-coach/diagnostics.html
   (it is also linked from the app's Credits screen as "Mic check (diagnostics)").
2. Tap **Record** and blow your call for about 5 seconds.
3. Note down and report back:
   - the three **Voice processing** values: Echo cancellation, Noise suppression, Auto gain control,
   - whether it says voice processing is **off** (processingOff),
   - the **Sample rate**,
   - whether the **Playback** sounds natural (like your call, not muffled or pumping),
   - a screenshot of the **Spectrum** picture.

If voice processing stays on, the app still works, but tone scores are less reliable and the Results screen says so.

## How to practise

1. On Home, pick a call.
2. Tap **Play target** to hear what you are aiming for.
3. Tap **Record**, blow the call, and stop (it also stops by itself after a short pause, or at 15 seconds).
4. Read your score and tips, tap **Play mine** to hear yourself, then **Try again**.

The History screen shows your attempts and a progress chart for each call.

## Your own target (references)

By default you are scored against a real hen's call. If you have a call you like better (your own best attempt,
a friend, or a recording on your phone), open **References**, then record it or import the audio file and save it.
While a reference is active, that call is scored against it instead. Only the first 15 seconds of a reference are
used, and imported files must be under 10 minutes and 20 MB. Tap **Use the built-in target** to go back.

## Backups

Your attempts and references live only on this phone. To keep them safe:

1. On **History**, tap **Back up**. The phone saves a backup file.
2. Keep that file somewhere safe, such as Google Drive.
3. To bring everything back (on a new phone, or after clearing the browser), tap **Restore from a backup file** on
   History and pick the file. Restoring adds what is missing and never overwrites what is already there.

## Privacy

Nothing leaves your phone. Recordings, scores and references are stored in the browser on the phone. The app makes
no network requests except loading itself, and has no accounts, analytics or ads. The only way your data leaves the
phone is a backup file you save yourself.

## How updates work

Pushing to the `main` branch on GitHub runs the tests and deploys the new version to GitHub Pages
(`.github/workflows/deploy.yml`), which takes a few minutes. The installed app picks up the new version the next
time it is opened with a connection; offline, it keeps using the version it already has. The Credits screen shows a
short build id, so you can tell which version you are running.

## For developers

You need Node.js 22.12 or newer.

```sh
npm install      # install the development tools (the app itself has no runtime dependencies)
npm test         # run the test suite (Vitest)
npm run dev      # local development server
npm run build    # type-check, then build the site into dist/
```

`scripts/make_assets.py` regenerates the bundled hen clips (`public/clips/`), the test recordings
(`tests/fixtures/`) and the app icons from the original xeno-canto downloads. You only need it if those files change;
its docstring explains the one-time Python setup.

## Credits

The bundled hen recordings come from xeno-canto and are used under their Creative Commons licenses. See
[CREDITS.md](CREDITS.md) for the recordists and licenses.
