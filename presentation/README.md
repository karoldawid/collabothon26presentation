# Atlas pitch deck

A pitch for Atlas ("Atlas lets your financial decisions land safely"): Alex's journey across the Atlas globe (Frankfurt → Berlin → Frankfurt → Rome → Tokyo). The pin always lands on the same spot, its callout carries the stop title, and a phone frame plays the app recording for each stop.

- Spec: [`.plans/atlas-pitch-deck-spec.md`](../.plans/atlas-pitch-deck-spec.md)
- The team's story and slide plan it came from: [`story-plan.md`](story-plan.md)
- Online copy (private, without recordings): https://claude.ai/artifact/7gW1zgrSqg5xXe8xBQ575d

## Run

Open `atlas-pitch.html` in Chrome or Edge and press F11. It needs no network and has no on-screen controls.

| Action | Keys |
|---|---|
| Next stop | → · space · PageDown · a clicker · a click on the slide |
| Previous stop (with all its steps shown) | ← |
| First / last stop | Home / End |

To send the deck, zip the whole `presentation/` folder: the recordings sit next to the HTML, not inside it.

## App recordings

They live in `clips/` with the names listed in [`clips/README.txt`](clips/README.txt), as `.mp4` (H.264) or `.webm`. `make record` (repo root) films all of them and copies them there; the `.mp4` files are committed, so the deck plays straight from a checkout.

- A missing clip shows a labelled placeholder in the phone frame.

## Edit

1. Change `src/atlas-pitch.html`. Each stop is one `<section class="stop">` with its city, lat/lng, colour, and callout title (`data-title`).
2. Mark steps with `data-step="1"`, `"2"` and so on. They show by themselves, in order: a step with `data-clip` (it swaps the phone recording) once the current recording has ended, any other step 3.5 s after the one before (`STEP_MS`). A click always goes to the next stop.
3. Rebuild the offline file:

   ```bash
   cd presentation/src && python3 make_offline.py   # writes ../atlas-pitch.html
   ```

`src/atlas-pitch.html` is also the page published online. It loads d3, topojson and Inter from CDNs and `land-110m.json` from its own folder. The offline build embeds all of them.

## Licences

d3 (ISC), topojson-client (ISC), world-atlas / Natural Earth (public domain), Inter (SIL OFL 1.1).
