import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMidi } from './midiImport'

const load = (f: string) => new Uint8Array(readFileSync(`test-fixtures/${f}`))

describe('MIDI import', () => {
  it('splits hands by track names', () => {
    const { song, info } = parseMidi(load('test-2track.mid'), 'Test')
    expect(info.usedMode).toBe('tracks')
    expect(song.notes.filter((n) => n.hand === 'R')).toHaveLength(15)
    expect(song.notes.filter((n) => n.hand === 'L')).toHaveLength(15)
    expect(song.notes[0].start).toBe(0)
    // 3/4 at 90 bpm → a bar every 2 s
    expect(song.bars[1]).toBeCloseTo(2, 3)
    expect(song.sections[0].label).toBe('Bars 1–4')
  })
  it('splits a single track by pitch around middle C', () => {
    const { song, info } = parseMidi(load('test-1track.mid'), 'Test')
    expect(info.usedMode).toBe('pitch')
    for (const n of song.notes) expect(n.hand).toBe(n.midi < 60 ? 'L' : 'R')
    expect(song.notes.filter((n) => n.hand === 'L')).toHaveLength(15)
  })
  it('can force pitch split on a 2-track file', () => {
    const { info } = parseMidi(load('test-2track.mid'), 'Test', 'pitch')
    expect(info.usedMode).toBe('pitch')
  })
})
