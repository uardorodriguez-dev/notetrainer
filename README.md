# Note Trainer

Music-reading practice for students. Open the pages in Chrome, or host the folder on GitHub Pages.

- `index.html`: **Note Trainer**. Name the note with buttons, or play it into the microphone (piano or guitar).
- `heart-defense.html`: **Heart Defense**. Bubbles carrying notes float toward a heart; name the note (buttons) or play it (microphone, piano or guitar) to pop them.

## How it is organised

| File | What it does |
|---|---|
| `js/music-engine.js` | Shared music logic: notes, ranges, random notes, answer choices, answer checking (tapped or heard). No screen code. |
| `js/glyphs.js` | Clef and sharp/flat shapes (from the free GNU FreeSerif font). |
| `js/staff-svg.js` | Draws one note on a staff as a small picture. Works offline. |
| `js/mic-listener.js` | Shared microphone listener: pitch detection and noise filters (identical to the trainer's), room and instrument calibration, plain-English reasons when a sound is ignored. |
| `js/heart-defense-game.js` | Heart Defense rules: waves, bubbles, hearts, score, streak bonuses. No screen code. |
| `js/heart-defense-view.js` | Heart Defense screen: drawing, buttons, keyboard, taps. |
| `assets/` | Heart and bubble videos (MP4, plus WebM for browsers without MP4). |
| `tests/` | Automated tests. Run them all with `sh run-tests.sh`. |

Difficulty for Heart Defense is one table at the top of `js/heart-defense-game.js` (`WAVES`), stretched by the Speed setting (`PACES`: Relaxed, Normal, Fast): bubbles per wave,
seconds between bubbles, seconds to reach the heart, bubbles on screen at once, and note range.

Note: `index.html` still has its own copy of the music theory and microphone code (tests check it gives the same answers as
`js/music-engine.js` and `js/mic-listener.js`). It can switch to the shared engine file when the trainer is next updated.

License: code under the MIT License (see `LICENSE`). The videos in `assets/` are not covered by it.
Privacy: neither page collects any information. Scores and settings stay on the device, and microphone sound is analysed in the browser and never sent anywhere.
