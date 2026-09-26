# Joe Piano Practice

Falling-notes piano practice for Joe: Happy Birthday, working up to the Betacustic "HARD" tutorial.
Runs in the browser. No account. Everything is stored on the device.

Live: https://dsu9944.github.io/Joe-piano-practice/

- **Betacustic tutorial video** (YouTube embed, never downloaded): speeds 0.25–1×, A/B loop with a 3-beep countdown gap, saved named sections.
- **Falling-notes player** (canvas + WebAudio synth): tempo 40–120%, RH/LH/both, loop by line or bars, wait at the end of each line, note names, tap keys to hear a note.
  - **Betacustic arrangement (your MIDI file)**: load the purchased .mid; it's kept in IndexedDB.
  - **Warm-ups** (original arrangements of the public-domain tune): Stages 1–3 in C or F, Stage 4 Advanced in F (or C).
  - **Other MIDI file**.
- **Record yourself** (mic or upload), takes kept in IndexedDB.

Dev: `npm install`, `npm run dev`, `npm test` (melody + MIDI import checks), `npm run build`.
Deploy: build, then publish `dist/` to the `gh-pages` branch (GitHub Pages, legacy build from that branch).
`node scripts/make-test-midi.mjs` regenerates the self-made test MIDI files in `test-fixtures/`.
