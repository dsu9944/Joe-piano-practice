// Generates self-made test MIDI files (NOT any published arrangement):
//  test-2track.mid  — "Right Hand"/"Left Hand" tracks, 3/4 at 90 bpm, F-major scale exercise
//  test-1track.mid  — the same notes merged into one track (split by pitch around middle C)
import midiPkg from '@tonejs/midi'
import { writeFileSync, mkdirSync } from 'node:fs'
const { Midi } = midiPkg

function build(single) {
  const midi = new Midi()
  midi.header.setTempo(90)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4], measures: 0 })
  midi.header.update()
  const spb = 60 / 90
  const rh = midi.addTrack()
  rh.name = single ? 'Piano' : 'Right Hand'
  const lh = single ? rh : midi.addTrack()
  if (!single) lh.name = 'Left Hand'
  const scale = [65, 67, 69, 70, 72, 74, 76, 77, 76, 74, 72, 70, 69, 67, 65] // F4 up to F5 and back
  scale.forEach((m, i) => rh.addNote({ midi: m, time: i * spb, duration: spb * 0.95, velocity: 0.8 }))
  // LH: F2–C3–A3 broken chord each bar (bars of 3 beats), then C chord, then F
  const chords = [[41, 48, 57], [41, 48, 57], [36, 43, 52], [36, 43, 52], [41, 48, 57]]
  chords.forEach((c, bar) => c.forEach((m, j) => lh.addNote({ midi: m, time: (bar * 3 + j) * spb, duration: spb * 0.95, velocity: 0.6 })))
  return Buffer.from(midi.toArray())
}

mkdirSync('test-fixtures', { recursive: true })
writeFileSync('test-fixtures/test-2track.mid', build(false))
writeFileSync('test-fixtures/test-1track.mid', build(true))
console.log('wrote test-fixtures/test-2track.mid, test-fixtures/test-1track.mid')
