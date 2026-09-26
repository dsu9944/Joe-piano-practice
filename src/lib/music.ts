const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function isBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
}

export function noteName(midi: number, withOctave = true): string {
  const n = NAMES[((midi % 12) + 12) % 12]
  return withOctave ? `${n}${Math.floor(midi / 12) - 1}` : n
}

/** "G4" / "C#5" / "Bb3" → MIDI number. */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim())
  if (!m) throw new Error(`Bad note name: ${name}`)
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let v = base[m[1].toUpperCase()]
  if (m[2] === '#') v += 1
  if (m[2] === 'b') v -= 1
  return (parseInt(m[3], 10) + 1) * 12 + v
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
