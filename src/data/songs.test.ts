import { describe, expect, it } from 'vitest'
import { noteName } from '../lib/music'
import { buildWarmUp, stage1, stage2, stage3, stage4 } from './songs'
import type { Song } from '../types'

// The melody spec from Joe's brief, line by line (letter names only).
const SPEC_LINES = [
  ['G', 'G', 'A', 'G', 'C', 'B'],
  ['G', 'G', 'A', 'G', 'D', 'C'],
  ['G', 'G', 'G', 'E', 'C', 'B', 'A'],
  ['F', 'F', 'E', 'C', 'D', 'C'],
]
// Standard 3/4 rhythm with a two-eighth pickup before each line (beats).
const SPEC_RHYTHM = [
  0.5, 0.5, 1, 1, 1, 2,
  0.5, 0.5, 1, 1, 1, 2,
  0.5, 0.5, 1, 1, 1, 1, 1,
  0.5, 0.5, 1, 1, 1, 3,
]

function melody(song: Song) {
  const spb = 60 / (song.bpm ?? 100)
  return song.notes
    .filter((n) => n.melody)
    .sort((a, b) => a.start - b.start)
    .map((n) => ({ name: noteName(n.midi), letter: noteName(n.midi, false), beats: +(n.dur / spb).toFixed(3), start: +(n.start / spb).toFixed(3) }))
}

describe('warm-up stages 1–3 (C major)', () => {
  for (const song of [stage1(), stage2(), stage3()]) {
    it(`${song.id}: melody pitches + rhythm match the spec`, () => {
      const m = melody(song)
      expect(m.map((x) => x.letter)).toEqual(SPEC_LINES.flat())
      expect(m.map((x) => x.beats)).toEqual(SPEC_RHYTHM)
      // Starts on G4, octave leap to G5 on line 3, stays within G4–G5
      expect(m[0].name).toBe('G4')
      expect(m[14].name).toBe('G5')
      const midis = song.notes.filter((n) => n.melody).map((n) => n.midi)
      expect(Math.min(...midis)).toBe(67)
      expect(Math.max(...midis)).toBe(79)
      // Notes are contiguous (no gaps/overlaps) and fill 25 beats (pickup + 8 bars of 3/4)
      let t = 0
      for (const x of m) {
        expect(x.start).toBeCloseTo(t, 6)
        t += x.beats
      }
      expect(t).toBe(25)
      // The melody is always the highest sounding RH note
      for (const n of song.notes.filter((k) => k.hand === 'R' && !k.melody)) {
        const mel = song.notes.find((k) => k.melody && Math.abs(k.start - n.start) < 1e-6)!
        expect(n.midi).toBeLessThan(mel.midi)
      }
    })
  }

  it('stage 1 LH chords per bar: C G G C C F C–G C', () => {
    const s = stage1()
    const spb = 60 / s.bpm!
    const lh = s.notes.filter((n) => n.hand === 'L')
    const chordAt = (beat: number) =>
      lh.filter((n) => Math.abs(n.start / spb - beat) < 1e-6).map((n) => noteName(n.midi, false)).sort().join('')
    const bars = [1, 4, 7, 10, 13, 16, 19, 22]
    expect(bars.map(chordAt)).toEqual(['CEG', 'BDG', 'BDG', 'CEG', 'CEG', 'ACF', 'CEG', 'CEG'])
    expect(chordAt(21)).toBe('BDG') // bar 7 beat 3 → G
    expect(Math.min(...lh.map((n) => n.midi))).toBeGreaterThanOrEqual(48) // nothing below C3
  })

  it('stage 2 LH is a waltz: 1 bass note on beat 1, 2-note chords on beats 2 and 3', () => {
    const s = stage2()
    const spb = 60 / s.bpm!
    const lh = s.notes.filter((n) => n.hand === 'L')
    for (const bar of [1, 2, 3, 4, 5, 6]) {
      const b = 1 + 3 * (bar - 1)
      const at = (beat: number) => lh.filter((n) => Math.abs(n.start / spb - beat) < 1e-6)
      expect(at(b)).toHaveLength(1)
      expect(at(b + 1)).toHaveLength(2)
      expect(at(b + 2)).toHaveLength(2)
      expect(at(b)[0].midi).toBeLessThan(Math.min(...at(b + 1).map((n) => n.midi)))
    }
  })

  it('stage 3 harmony notes are a 3rd or 6th below the melody', () => {
    const s = stage3()
    const harm = s.notes.filter((n) => n.hand === 'R' && !n.melody)
    expect(harm.length).toBeGreaterThan(10)
    for (const h of harm) {
      const mel = s.notes.find((k) => k.melody && Math.abs(k.start - h.start) < 1e-6)!
      expect([3, 4, 8, 9]).toContain(mel.midi - h.midi)
    }
  })
})

describe('transpose to F', () => {
  it('moves stages 1–3 up a perfect 4th (melody starts C5)', () => {
    const f = buildWarmUp('stage1', 'F')
    const m = melody(f)
    expect(m[0].name).toBe('C5')
    expect(m.map((x) => x.letter).slice(0, 6)).toEqual(['C', 'C', 'D', 'C', 'F', 'E'])
  })
  it('stage 4 is native F; C version moves it down a 4th', () => {
    expect(melody(buildWarmUp('stage4', 'F'))[0].name).toBe('C5')
    expect(melody(buildWarmUp('stage4', 'C'))[0].name).toBe('G4')
  })
})

describe('stage 4 advanced (F major, original)', () => {
  const s = stage4()
  it('verse melody is Happy Birthday in F with the standard rhythm', () => {
    const m = melody(s)
    const fLetters = [
      ['C', 'C', 'D', 'C', 'F', 'E'],
      ['C', 'C', 'D', 'C', 'G', 'F'],
      ['C', 'C', 'C', 'A', 'F', 'E', 'D'],
      ['Bb', 'Bb', 'A', 'F', 'G', 'F'],
    ].flat()
    expect(m.map((x) => x.letter)).toEqual(fLetters)
    expect(m.map((x) => x.beats).slice(0, -1)).toEqual(SPEC_RHYTHM.slice(0, -1))
  })
  it('has an intro, RH octaves, wide LH arpeggios, and an ending', () => {
    const spb = 60 / s.bpm!
    expect(s.notes.some((n) => n.start / spb < 11)).toBe(true) // intro
    expect(s.duration / spb).toBe(48)
    for (const m of s.notes.filter((n) => n.melody)) {
      expect(s.notes.some((n) => n.hand === 'R' && n.midi === m.midi - 12 && Math.abs(n.start - m.start) < 1e-6)).toBe(true)
    }
    const lh = s.notes.filter((n) => n.hand === 'L').map((n) => n.midi)
    expect(Math.max(...lh) - Math.min(...lh)).toBeGreaterThanOrEqual(24)
    // Only diatonic-to-F notes plus the chromatic passing tones we chose (F#, Db, Eb)
    const allowed = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'F#', 'Db', 'Eb'])
    for (const n of s.notes) expect(allowed.has(noteName(n.midi, false))).toBe(true)
  })
  it('no two notes on the same key overlap in time within a hand', () => {
    for (const song of [stage1(), stage2(), stage3(), s]) {
      const sorted = [...song.notes].sort((a, b) => a.midi - b.midi || a.start - b.start)
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]
        const b = sorted[i]
        if (a.midi === b.midi) expect(b.start).toBeGreaterThanOrEqual(a.start + a.dur - 1e-6)
      }
    }
  })
})
