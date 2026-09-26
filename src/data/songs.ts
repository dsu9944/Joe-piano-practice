/**
 * Joe's own warm-up arrangements of "Happy Birthday to You" (public-domain tune).
 * Written from scratch for this app — NOT transcriptions of any published arrangement.
 * Times are authored in beats (quarter note = 1 beat, 3/4 time) and converted to seconds.
 */
import type { Hand, Song, SongNote, SongSection } from '../types'
import { parseNote } from '../lib/music'

interface Ev {
  hand: Hand
  notes: string[]
  beat: number
  dur: number
  vel?: number
  melody?: boolean
}

interface Draft {
  id: string
  title: string
  bpm: number
  barBeats: number[]
  barLabels: string[]
  sections: { label: string; start: number; end: number }[]
  endBeat: number
  events: Ev[]
}

function toSong(d: Draft): Song {
  const spb = 60 / d.bpm
  const notes: SongNote[] = []
  for (const e of d.events) {
    for (const n of e.notes) {
      notes.push({
        midi: parseNote(n),
        start: e.beat * spb,
        dur: e.dur * spb,
        hand: e.hand,
        velocity: e.vel ?? (e.hand === 'R' ? 0.8 : 0.6),
        ...(e.melody ? { melody: true } : {}),
      })
    }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi)
  const sections: SongSection[] = d.sections.map((s) => ({
    label: s.label,
    start: s.start * spb,
    end: s.end * spb,
  }))
  return {
    id: d.id,
    title: d.title,
    notes,
    bars: d.barBeats.map((b) => b * spb),
    barLabels: d.barLabels,
    sections,
    duration: d.endBeat * spb,
    bpm: d.bpm,
  }
}

/** Shift every note by `semitones`. */
export function transposeSong(song: Song, semitones: number, suffix = ''): Song {
  if (!semitones) return song
  return {
    ...song,
    id: `${song.id}@${semitones}`,
    title: suffix ? `${song.title} ${suffix}` : song.title,
    notes: song.notes.map((n) => ({ ...n, midi: n.midi + semitones })),
  }
}

// ---------------------------------------------------------------------------
// Stages 1–3 (written in C major). Pickup = beat 0–1; bar n starts at 1 + 3(n-1).
// ---------------------------------------------------------------------------

/** [note, startBeat, durBeats] — the melody exactly as specified. */
export const MELODY_C: [string, number, number][] = [
  // line 1: G G A G C B
  ['G4', 0, 0.5], ['G4', 0.5, 0.5], ['A4', 1, 1], ['G4', 2, 1], ['C5', 3, 1], ['B4', 4, 2],
  // line 2: G G A G D C
  ['G4', 6, 0.5], ['G4', 6.5, 0.5], ['A4', 7, 1], ['G4', 8, 1], ['D5', 9, 1], ['C5', 10, 2],
  // line 3: G G G' E C B A
  ['G4', 12, 0.5], ['G4', 12.5, 0.5], ['G5', 13, 1], ['E5', 14, 1], ['C5', 15, 1], ['B4', 16, 1], ['A4', 17, 1],
  // line 4: F F E C D C
  ['F5', 18, 0.5], ['F5', 18.5, 0.5], ['E5', 19, 1], ['C5', 20, 1], ['D5', 21, 1], ['C5', 22, 3],
]

const BARS_C = [0, 1, 4, 7, 10, 13, 16, 19, 22]
const BAR_LABELS_C = ['Pickup', '1', '2', '3', '4', '5', '6', '7', '8']
const LINES_C = [
  { label: 'Line 1 — “Happy birthday to you”', start: 0, end: 6 },
  { label: 'Line 2 — “Happy birthday to you”', start: 6, end: 12 },
  { label: 'Line 3 — “Happy birthday dear Joe”', start: 12, end: 18 },
  { label: 'Line 4 — “Happy birthday to you”', start: 18, end: 25 },
]

const barStart = (bar: number) => 1 + 3 * (bar - 1)

function melodyEvents(): Ev[] {
  return MELODY_C.map(([n, beat, dur]) => ({ hand: 'R', notes: [n], beat, dur, vel: 0.85, melody: true }))
}

/** Close-position voicings around C3 (none below C3 for stage 1). */
const BLOCK: Record<string, string[]> = {
  C: ['C3', 'E3', 'G3'],
  G: ['D3', 'G3', 'B3'],
  F: ['C3', 'F3', 'A3'],
}

/** Waltz voicings: bass on beat 1, upper chord notes on beats 2 & 3. */
const WALTZ: Record<string, { bass: string; upper: string[] }> = {
  C: { bass: 'C3', upper: ['E3', 'G3'] },
  G: { bass: 'G2', upper: ['B2', 'D3'] },
  F: { bass: 'F2', upper: ['A2', 'C3'] },
}

/** Chord per bar 1–8 ("C-G" = C for beats 1–2, G on beat 3). */
export const CHORDS_C = ['C', 'G', 'G', 'C', 'C', 'F', 'C-G', 'C']

function blockChordEvents(): Ev[] {
  const out: Ev[] = []
  CHORDS_C.forEach((ch, i) => {
    const b = barStart(i + 1)
    if (ch === 'C-G') {
      out.push({ hand: 'L', notes: BLOCK.C, beat: b, dur: 2 })
      out.push({ hand: 'L', notes: BLOCK.G, beat: b + 2, dur: 1 })
    } else {
      out.push({ hand: 'L', notes: BLOCK[ch], beat: b, dur: 3 })
    }
  })
  return out
}

function waltzEvents(): Ev[] {
  const out: Ev[] = []
  CHORDS_C.forEach((ch, i) => {
    const b = barStart(i + 1)
    if (i === CHORDS_C.length - 1) {
      // Final bar: bass + chord held together (a settled ending).
      out.push({ hand: 'L', notes: [WALTZ.C.bass, ...WALTZ.C.upper], beat: b, dur: 3 })
      return
    }
    if (ch === 'C-G') {
      out.push({ hand: 'L', notes: [WALTZ.C.bass], beat: b, dur: 1 })
      out.push({ hand: 'L', notes: WALTZ.C.upper, beat: b + 1, dur: 1, vel: 0.45 })
      out.push({ hand: 'L', notes: [WALTZ.G.bass], beat: b + 2, dur: 1 })
      return
    }
    const w = WALTZ[ch]
    out.push({ hand: 'L', notes: [w.bass], beat: b, dur: 1 })
    out.push({ hand: 'L', notes: w.upper, beat: b + 1, dur: 1, vel: 0.45 })
    out.push({ hand: 'L', notes: w.upper, beat: b + 2, dur: 1, vel: 0.45 })
  })
  return out
}

/** Harmony note (a 3rd or 6th below) per melody index, or null. */
const HARMONY_C: (string | null)[] = [
  null, null, 'C4', 'E4', 'E4', 'G4', // line 1: A/C(6th) G/E(3rd) C/E(6th) B/G(3rd)
  null, null, null, 'B3', 'B4', 'E4', // line 2: G/B(6th) D/B(3rd) C/E(6th)
  null, null, 'E5', 'C5', 'E4', 'G4', 'F4', // line 3: G'/E E/C C/E B/G A/F
  null, null, 'C5', 'E4', 'B4', 'E4', // line 4: E/C C/E D/B C/E
]

function harmonyEvents(): Ev[] {
  const out: Ev[] = []
  MELODY_C.forEach(([, beat, dur], i) => {
    const h = HARMONY_C[i]
    if (h) out.push({ hand: 'R', notes: [h], beat, dur, vel: 0.5 })
  })
  return out
}

const commonC = {
  bpm: 100,
  barBeats: BARS_C,
  barLabels: BAR_LABELS_C,
  sections: LINES_C,
  endBeat: 25,
}

export function stage1(): Song {
  return toSong({
    ...commonC,
    id: 'stage1',
    title: 'Stage 1 — Melody + held chords',
    events: [...melodyEvents(), ...blockChordEvents()],
  })
}

export function stage2(): Song {
  return toSong({
    ...commonC,
    id: 'stage2',
    title: 'Stage 2 — Melody + LH waltz',
    events: [...melodyEvents(), ...waltzEvents()],
  })
}

export function stage3(): Song {
  return toSong({
    ...commonC,
    id: 'stage3',
    title: 'Stage 3 — RH harmony + LH waltz',
    events: [...melodyEvents(), ...harmonyEvents(), ...waltzEvents()],
  })
}

// ---------------------------------------------------------------------------
// Stage 4 — Advanced (original arrangement, written in F major).
// Intro (4 bars) → verse with RH octaves + inner harmony, LH arpeggios,
// secondary dominants (D7→Gm7, F7→Bb), minor iv (Bbm6), deceptive Dm7, tag + ending.
// Beats: intro bars at 0,3,6,9; verse pickup at 11; verse bar k at 12+3(k-1).
// ---------------------------------------------------------------------------

/** Melody of the verse in F: [note, beat, dur]. Same tune as MELODY_C, up a 4th. */
export const MELODY_F_STAGE4: [string, number, number][] = [
  ['C5', 11, 0.5], ['C5', 11.5, 0.5], ['D5', 12, 1], ['C5', 13, 1], ['F5', 14, 1], ['E5', 15, 2],
  ['C5', 17, 0.5], ['C5', 17.5, 0.5], ['D5', 18, 1], ['C5', 19, 1], ['G5', 20, 1], ['F5', 21, 2],
  ['C5', 23, 0.5], ['C5', 23.5, 0.5], ['C6', 24, 1], ['A5', 25, 1], ['F5', 26, 1], ['E5', 27, 1], ['D5', 28, 1],
  ['Bb5', 29, 0.5], ['Bb5', 29.5, 0.5], ['A5', 30, 1], ['F5', 31, 1], ['G5', 32, 1], ['F5', 33, 2],
]

/** Inner harmony (between melody and its lower octave) per melody note. */
const INNER_F: string[][] = [
  [], [], ['A4'], ['A4'], ['C5'], ['Bb4'], // F: D/A C/A F/C | C7: E/Bb
  ['F#4'], ['F#4'], ['Bb4'], ['F4'], ['E5'], ['C5', 'A4'], // D7 pickup | Gm7 … C7 | F
  ['Eb4'], ['Eb4'], ['F5'], ['D5'], ['Bb4'], ['Bb4'], ['Bb4'], // F7 pickup | Bbmaj7 | C7/E, Gm7
  ['F5', 'Db5'], ['G5', 'Db5'], ['F5', 'C5'], ['C5'], ['E5', 'Bb4'], ['D5', 'A4'], // Bbm6 | F/C … C7 | Dm7
]

function stage4Events(): Ev[] {
  const ev: Ev[] = []
  const R = (notes: string[], beat: number, dur: number, vel = 0.62) =>
    ev.push({ hand: 'R', notes, beat, dur, vel })
  const L = (notes: string[], beat: number, dur: number, vel = 0.55) =>
    ev.push({ hand: 'L', notes, beat, dur, vel })
  /** LH broken chord in eighth notes starting at `beat`. */
  const arp = (notes: string[], beat: number, vel = 0.55) =>
    notes.forEach((n, i) => L([n], beat + i * 0.5, 0.5, i === 0 ? vel + 0.08 : vel))

  // --- Intro (I–vi7–ii7–V7–I), RH in thirds, LH two-octave arpeggios ---
  R(['A5', 'C6'], 0, 2, 0.7); R(['G5', 'Bb5'], 2, 0.5); R(['F5', 'A5'], 2.5, 0.5)
  arp(['F2', 'C3', 'F3', 'A3', 'C4', 'A3'], 0)
  R(['F5', 'A5'], 3, 2, 0.7); R(['E5', 'G5'], 5, 0.5); R(['D5', 'F5'], 5.5, 0.5)
  arp(['D2', 'A2', 'D3', 'F3', 'C4', 'F3'], 3)
  R(['D5', 'G5'], 6, 1, 0.7); R(['G5', 'Bb5'], 7, 1); R(['C5', 'E5'], 8, 1)
  arp(['G2', 'D3', 'F3', 'Bb3'], 6); arp(['C2', 'E3'], 8)
  R(['A4', 'C5', 'F5'], 9, 2, 0.7)
  arp(['F2', 'C3', 'F3', 'A3'], 9); arp(['C3', 'Bb3'], 11)

  // --- Verse: melody in octaves (+ inner harmony) ---
  MELODY_F_STAGE4.forEach(([n, beat, dur], i) => {
    ev.push({ hand: 'R', notes: [n], beat, dur, vel: 0.9, melody: true })
    const lower = parseNote(n) - 12
    const low = NOTE_BY_MIDI(lower)
    // Held notes: lower octave is shorter so the inner fill can speak.
    const lowDur = dur >= 2 && i !== MELODY_F_STAGE4.length - 1 ? 1 : dur
    R([low, ...INNER_F[i]], beat, lowDur, 0.6)
  })
  // Fills under held notes (bar 2 and bar 4, beat 2)
  R(['Bb4'], 16, 0.5, 0.5); R(['G4'], 16.5, 0.5, 0.5)
  R(['A4'], 22, 0.5, 0.5); R(['C5'], 22.5, 0.5, 0.5)
  // Bar 8 fill leading into the tag (sixteenths)
  ;['A5', 'G5', 'F5', 'E5'].forEach((n, i) => R([n], 35 + i * 0.25, 0.25, 0.6))

  // LH arpeggios for the verse
  arp(['F2', 'C3', 'F3', 'A3', 'C4', 'A3'], 12) // bar 1: F
  arp(['C2', 'G2', 'E3', 'Bb3'], 15); arp(['D3', 'F#3'], 17) // bar 2: C7 → D7 (V/ii)
  arp(['G2', 'D3', 'F3', 'Bb3'], 18); arp(['C3', 'E3'], 20) // bar 3: Gm7 → C7
  arp(['F2', 'C3', 'F3', 'A3'], 21); arp(['Eb3', 'A3'], 23) // bar 4: F → F7 (V/IV)
  arp(['Bb2', 'F3', 'A3', 'D4', 'A3', 'F3'], 24) // bar 5: Bbmaj7
  arp(['E2', 'C3'], 27); arp(['G2', 'F3'], 28); arp(['Bb2', 'Db3'], 29) // bar 6: C7/E → Gm7 → Bbm6
  arp(['C2', 'A2', 'F3', 'A3'], 30); arp(['C2', 'Bb2'], 32) // bar 7: F/C → C7
  arp(['D2', 'A2', 'D3', 'F3', 'C4', 'F3'], 33) // bar 8: Dm7 (deceptive)

  // --- Tag + ending ---
  ev.push({ hand: 'R', notes: ['A5'], beat: 36, dur: 1, vel: 0.9 })
  R(['A4', 'D5', 'F5'], 36, 1, 0.6) // Bbmaj7 colour
  ev.push({ hand: 'R', notes: ['F5'], beat: 37, dur: 1, vel: 0.85 })
  R(['F4', 'Bb4', 'D5'], 37, 1, 0.55) // Gm7
  ev.push({ hand: 'R', notes: ['G5'], beat: 38, dur: 1, vel: 0.85 })
  R(['G4', 'Bb4', 'E5'], 38, 1, 0.55) // C7
  arp(['Bb2', 'F3'], 36); arp(['G2', 'D3'], 37); arp(['C2', 'Bb2'], 38)

  ev.push({ hand: 'R', notes: ['F5'], beat: 39, dur: 3, vel: 0.85 })
  R(['F4', 'A4', 'C5'], 39, 3, 0.55)
  arp(['F2', 'C3', 'F3', 'A3', 'C4', 'A3'], 39)

  // Minor-plagal run (Bbm6/F) up to F6
  ;['F4', 'Bb4', 'Db5', 'F5', 'Bb5', 'Db6'].forEach((n, i) => R([n], 42 + i * 0.25, 0.25, 0.6 + i * 0.04))
  R(['F6'], 43.5, 1.5, 0.85)
  L(['F2'], 42, 3, 0.6); L(['Db3', 'G3', 'Bb3'], 42.5, 2.5, 0.45)

  // Final F major chord
  R(['F5', 'A5', 'C6', 'F6'], 45, 3, 0.8)
  L(['F2', 'F3', 'C3'], 45, 3, 0.7)
  return ev
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
function NOTE_BY_MIDI(m: number): string {
  return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
}

export function stage4(): Song {
  const barBeats = [0, 3, 6, 9, ...Array.from({ length: 12 }, (_, i) => 12 + 3 * i)]
  const barLabels = ['Intro 1', 'Intro 2', 'Intro 3', 'Intro 4', ...Array.from({ length: 12 }, (_, i) => `${i + 1}`)]
  return toSong({
    id: 'stage4',
    title: 'Stage 4 — Advanced (my own arrangement)',
    bpm: 84,
    barBeats,
    barLabels,
    sections: [
      { label: 'Intro', start: 0, end: 11 },
      { label: 'Line 1 — “Happy birthday to you”', start: 11, end: 17 },
      { label: 'Line 2 — “Happy birthday to you”', start: 17, end: 23 },
      { label: 'Line 3 — “Happy birthday dear Joe”', start: 23, end: 29 },
      { label: 'Line 4 — “Happy birthday to you”', start: 29, end: 36 },
      { label: 'Tag + ending', start: 36, end: 48 },
    ],
    endBeat: 48,
    events: stage4Events(),
  })
}

export type KeyName = 'C' | 'F'

export interface WarmUp {
  id: string
  label: string
  nativeKey: KeyName
  build: () => Song
}

export const WARM_UPS: WarmUp[] = [
  { id: 'stage1', label: 'Stage 1 — Melody + held chords', nativeKey: 'C', build: stage1 },
  { id: 'stage2', label: 'Stage 2 — Melody + LH waltz', nativeKey: 'C', build: stage2 },
  { id: 'stage3', label: 'Stage 3 — RH harmony + LH waltz', nativeKey: 'C', build: stage3 },
  { id: 'stage4', label: 'Stage 4 — Advanced (in F)', nativeKey: 'F', build: stage4 },
]

/** Semitone shift to move from `from` key to `to` key (F is +5 from C; C is −5 from F). */
export function keyShift(from: KeyName, to: KeyName): number {
  if (from === to) return 0
  return from === 'C' ? 5 : -5
}

export function buildWarmUp(id: string, key: KeyName): Song {
  const w = WARM_UPS.find((x) => x.id === id) ?? WARM_UPS[0]
  const song = w.build()
  const shift = keyShift(w.nativeKey, key)
  return transposeSong(song, shift, shift ? `(in ${key})` : '')
}
