/** Convert a .mid file into a falling-notes Song using @tonejs/midi. */
import { Midi } from '@tonejs/midi'
import type { Hand, Song, SongNote, SongSection } from '../types'

export type SplitMode = 'auto' | 'tracks' | 'pitch'

export interface MidiInfo {
  trackCount: number
  /** Tracks that contain notes, with the hand assigned in 'tracks' mode. */
  tracks: { name: string; notes: number; hand: Hand; avgPitch: number }[]
  usedMode: 'tracks' | 'pitch'
}

const MIDDLE_C = 60

function handFromName(name: string): Hand | null {
  const n = name.toLowerCase()
  if (/\b(left|lh|l\.h\.|bass)\b|left hand|links/.test(n)) return 'L'
  if (/\b(right|rh|r\.h\.|treble|melody)\b|right hand|rechts/.test(n)) return 'R'
  return null
}

export function parseMidi(data: ArrayBuffer | Uint8Array, title: string, split: SplitMode = 'auto', id = 'midi'): { song: Song; info: MidiInfo } {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data))
  // Drop drum channel (10) tracks.
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && t.channel !== 9)
  if (tracks.length === 0) throw new Error('No piano notes found in that MIDI file.')

  const stats = tracks.map((t) => ({
    track: t,
    name: t.name || t.instrument?.name || 'Track',
    avgPitch: t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length,
  }))

  // Track → hand: explicit names win, otherwise highest-average track = RH, others by pitch vs. middle C.
  const named = stats.map((s) => handFromName(s.name))
  const highest = stats.reduce((a, b) => (b.avgPitch > a.avgPitch ? b : a))
  const trackHands: Hand[] = stats.map((s, i) => {
    if (named[i]) return named[i]!
    if (stats.length === 1) return 'R'
    if (s === highest) return 'R'
    return s.avgPitch >= MIDDLE_C ? 'R' : 'L'
  })
  const useTracks =
    split === 'tracks' || (split === 'auto' && stats.length >= 2 && new Set(trackHands).size === 2)
  const usedMode: 'tracks' | 'pitch' = useTracks ? 'tracks' : 'pitch'

  const notes: SongNote[] = []
  stats.forEach((s, i) => {
    for (const n of s.track.notes) {
      const hand: Hand = useTracks ? trackHands[i] : n.midi < MIDDLE_C ? 'L' : 'R'
      notes.push({
        midi: n.midi,
        start: n.time,
        dur: Math.max(0.05, n.duration),
        hand,
        velocity: n.velocity,
      })
    }
  })
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi)
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0)

  // Bars from the tempo map + time signatures.
  const header = midi.header
  const ppq = header.ppq || 480
  const ts = header.timeSignatures.length ? header.timeSignatures : [{ ticks: 0, timeSignature: [4, 4] as number[] }]
  const endTick = header.secondsToTicks(lastEnd)
  const barTicks: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const [num, den] = ts[i].timeSignature
    const len = Math.round(ppq * num * (4 / den))
    const segEnd = i + 1 < ts.length ? ts[i + 1].ticks : endTick + 1
    for (let t = ts[i].ticks; t < segEnd; t += len) barTicks.push(t)
    if (barTicks.length > 2000) break
  }
  if (barTicks.length === 0) barTicks.push(0)
  const bars = barTicks.map((t) => header.ticksToSeconds(t))
  const barLabels = bars.map((_, i) => `${i + 1}`)

  // Sections: groups of 4 bars.
  const sections: SongSection[] = []
  for (let i = 0; i < bars.length; i += 4) {
    const start = bars[i]
    const end = i + 4 < bars.length ? bars[i + 4] : lastEnd
    if (end - start > 0.05) sections.push({ label: `Bars ${i + 1}–${Math.min(i + 4, bars.length)}`, start, end })
  }

  const bpm = header.tempos[0]?.bpm
  return {
    song: {
      id,
      title,
      notes,
      bars,
      barLabels,
      sections,
      duration: lastEnd,
      bpm: bpm ? Math.round(bpm) : undefined,
    },
    info: {
      trackCount: midi.tracks.length,
      tracks: stats.map((s, i) => ({ name: s.name, notes: s.track.notes.length, hand: trackHands[i], avgPitch: s.avgPitch })),
      usedMode,
    },
  }
}
