import { useCallback, useEffect, useMemo, useState } from 'react'
import { FallingNotes, type PlayerPrefs } from './components/FallingNotes'
import { MidiSlot } from './components/MidiSlot'
import { Recorder } from './components/Recorder'
import { TakesList } from './components/TakesList'
import { TutorialVideo } from './components/TutorialVideo'
import { buildWarmUp, WARM_UPS, type KeyName } from './data/songs'
import { unlockLoopCueAudio } from './lib/loopCue'
import { parseMidi, type MidiInfo, type SplitMode } from './lib/midiImport'
import {
  deleteMidi,
  deleteTake,
  getMidi,
  listTakes,
  loadPrefs,
  saveMidi,
  savePrefs,
  saveTake,
  updateTakeNotes,
  type MidiSlot as Slot,
  type StoredMidi,
} from './lib/storage'
import type { Song, Take } from './types'
import './App.css'

const VIDEO_ID = 'km99bZrYIbU'
const VIDEO_TITLE = 'Happy Birthday To You | HARD PIANO TUTORIAL + SHEET MUSIC — Betacustic'
const MIDI_LINK = 'https://bit.ly/351F32N'
const SHEET_LINK = 'https://www.musicnotes.com/l/T6VpJ'

type Source = 'betacustic' | 'warmup' | 'other'

interface AppPrefs {
  source: Source
  warmUpId: string
  key: KeyName
  split: Record<Slot, SplitMode>
  player: PlayerPrefs
}

const DEFAULT_PREFS: AppPrefs = {
  source: 'betacustic',
  warmUpId: 'stage1',
  key: 'C',
  split: { betacustic: 'auto', other: 'auto' },
  player: { tempo: 0.7, handMode: 'both', hideMuted: false, showNames: true, loop: false, waitEachLine: false },
}

async function isMidiFile(f: File): Promise<ArrayBuffer | null> {
  const buf = await f.arrayBuffer()
  const head = new Uint8Array(buf.slice(0, 4))
  return String.fromCharCode(...head) === 'MThd' ? buf : null
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export default function App() {
  const [prefs, setPrefs] = useState<AppPrefs>(() => {
    const p = loadPrefs(DEFAULT_PREFS)
    return { ...DEFAULT_PREFS, ...p, split: { ...DEFAULT_PREFS.split, ...p.split }, player: { ...DEFAULT_PREFS.player, ...p.player } }
  })
  const update = (patch: Partial<AppPrefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })

  const [midi, setMidi] = useState<Record<Slot, StoredMidi | null>>({ betacustic: null, other: null })
  const [midiErr, setMidiErr] = useState<Record<Slot, string | null>>({ betacustic: null, other: null })
  const [takes, setTakes] = useState<Take[]>([])
  const [takesErr, setTakesErr] = useState<string | null>(null)

  // Safari / iOS: unlock the AudioContext on the very first tap anywhere.
  useEffect(() => {
    const unlock = () => {
      void unlockLoopCueAudio()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [b, o] = await Promise.all([getMidi('betacustic'), getMidi('other')])
        setMidi({ betacustic: b, other: o })
      } catch (err) {
        console.error(err)
      }
    })()
  }, [])

  const refreshTakes = useCallback(async () => {
    try {
      setTakesErr(null)
      setTakes(await listTakes())
    } catch (err) {
      console.error(err)
      setTakesErr('Could not load saved takes from this browser.')
    }
  }, [])
  useEffect(() => {
    void refreshTakes()
  }, [refreshTakes])

  const parsed = useMemo(() => {
    const out: Record<Slot, { song: Song; info: MidiInfo } | { error: string } | null> = { betacustic: null, other: null }
    for (const slot of ['betacustic', 'other'] as Slot[]) {
      const m = midi[slot]
      if (!m) continue
      try {
        const title = slot === 'betacustic' ? 'Betacustic arrangement (your MIDI)' : m.fileName.replace(/\.midi?$/i, '')
        out[slot] = parseMidi(m.data.slice(0), title, prefs.split[slot], `midi-${slot}`)
      } catch (err) {
        out[slot] = { error: err instanceof Error ? err.message : 'Could not read that MIDI file.' }
      }
    }
    return out
  }, [midi, prefs.split])

  const song: Song | null = useMemo(() => {
    if (prefs.source === 'warmup') return buildWarmUp(prefs.warmUpId, prefs.key)
    const p = parsed[prefs.source]
    return p && 'song' in p ? p.song : null
  }, [prefs.source, prefs.warmUpId, prefs.key, parsed])

  const songLabel = useMemo(() => {
    if (prefs.source === 'warmup') {
      const w = WARM_UPS.find((x) => x.id === prefs.warmUpId) ?? WARM_UPS[0]
      return `Warm-up: ${w.label.split(' — ')[0]} in ${prefs.key}`
    }
    if (prefs.source === 'betacustic') return 'Betacustic arrangement'
    return midi.other?.fileName ?? 'Other MIDI'
  }, [prefs.source, prefs.warmUpId, prefs.key, midi.other])

  const loadMidi = async (slot: Slot, file: File) => {
    setMidiErr((e) => ({ ...e, [slot]: null }))
    const buf = await isMidiFile(file)
    if (!buf) {
      setMidiErr((e) => ({ ...e, [slot]: 'That doesn’t look like a MIDI file (.mid). Please choose the .mid file.' }))
      return
    }
    try {
      parseMidi(buf.slice(0), file.name, prefs.split[slot])
    } catch (err) {
      setMidiErr((e) => ({ ...e, [slot]: err instanceof Error ? err.message : 'Could not read that MIDI file.' }))
      return
    }
    await saveMidi(slot, file.name, buf)
    setMidi((m) => ({ ...m, [slot]: { slot, fileName: file.name, data: buf, savedAt: Date.now() } }))
    update({ source: slot })
  }

  const removeMidi = async (slot: Slot) => {
    await deleteMidi(slot)
    setMidi((m) => ({ ...m, [slot]: null }))
  }

  const handleSaveTake = async (blob: Blob, durationMs: number) => {
    await saveTake({ id: newId(), songLabel, createdAt: Date.now(), durationMs, blob, notes: '' })
    await refreshTakes()
  }

  const slotError = (slot: Slot) => {
    const p = parsed[slot]
    return midiErr[slot] ?? (p && 'error' in p ? p.error : null)
  }
  const slotInfo = (slot: Slot) => {
    const p = parsed[slot]
    return p && 'info' in p ? p.info : null
  }

  const tab = (s: Source, label: string) => (
    <button type="button" role="tab" aria-selected={prefs.source === s} className={`tab${prefs.source === s ? ' on' : ''}`} onClick={() => update({ source: s })}>
      {label}
    </button>
  )

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Happy Birthday · Betacustic tutorial</p>
        <h1>Joe Piano Practice</h1>
        <p className="tagline">
          Watch the tutorial, slow it down and loop the hard bits, then play along with the falling notes.
          Everything stays on this device — no account.
        </p>
      </header>

      <main className="main">
        <section className="card video-card" aria-labelledby="video-h">
          <h2 id="video-h">Betacustic tutorial</h2>
          <TutorialVideo youtubeId={VIDEO_ID} title={VIDEO_TITLE} />
        </section>

        <section className="card player-card" aria-labelledby="player-h">
          <h2 id="player-h">Falling notes</h2>
          <div className="tabs" role="tablist" aria-label="What to play">
            {tab('betacustic', '★ Betacustic arrangement')}
            {tab('warmup', 'Warm-up versions')}
            {tab('other', 'Other MIDI file')}
          </div>

          {prefs.source === 'betacustic' && (
            <div className="midi-slot featured">
              <h3>Betacustic arrangement (your MIDI file)</h3>
              <p className="hint">
                Betacustic sells the MIDI file for this arrangement (link in the video description), and the sheet
                music is on Musicnotes. Buy the MIDI, save the <b>.mid</b> to this device, then load it here. It
                plays below with all the same controls, and it stays saved here after a reload.
              </p>
              <p className="links">
                <a href={MIDI_LINK} target="_blank" rel="noopener noreferrer">Get the MIDI file ↗</a>
                <a href={SHEET_LINK} target="_blank" rel="noopener noreferrer">Sheet music on Musicnotes ↗</a>
              </p>
              <MidiSlot
                stored={midi.betacustic}
                info={slotInfo('betacustic')}
                error={slotError('betacustic')}
                split={prefs.split.betacustic}
                onSplit={(s) => update({ split: { ...prefs.split, betacustic: s } })}
                onLoad={(f) => loadMidi('betacustic', f)}
                onRemove={() => void removeMidi('betacustic')}
                buttonLabel="🎹 Load my Betacustic .mid"
              />
            </div>
          )}

          {prefs.source === 'warmup' && (
            <div className="warmup-pick">
              <label className="ctl">
                <span>Warm-up</span>
                <select className="piece-select small" value={prefs.warmUpId} onChange={(e) => update({ warmUpId: e.target.value })}>
                  {WARM_UPS.map((w) => (
                    <option key={w.id} value={w.id}>{w.label}</option>
                  ))}
                </select>
              </label>
              <div className="ctl">
                <span>Key</span>
                <div className="segs" role="group" aria-label="Key">
                  {(['C', 'F'] as KeyName[]).map((k) => (
                    <button key={k} type="button" className={`seg${prefs.key === k ? ' on' : ''}`} aria-pressed={prefs.key === k} onClick={() => update({ key: k })}>
                      {k} major{k === 'F' ? ' (Betacustic’s key)' : ''}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hint warmup-note">
                My own simple arrangements of the (public-domain) tune, building up to the real thing: 1 melody +
                held chords → 2 waltz left hand → 3 right-hand harmony → 4 an advanced showy version in F.
              </p>
            </div>
          )}

          {prefs.source === 'other' && (
            <div className="midi-slot">
              <h3>Any other MIDI file</h3>
              <p className="hint">Load any .mid from this device. Two-track files use the tracks as hands; otherwise notes split at middle C.</p>
              <MidiSlot
                stored={midi.other}
                info={slotInfo('other')}
                error={slotError('other')}
                split={prefs.split.other}
                onSplit={(s) => update({ split: { ...prefs.split, other: s } })}
                onLoad={(f) => loadMidi('other', f)}
                onRemove={() => void removeMidi('other')}
                buttonLabel="⬆ Load a .mid file"
              />
            </div>
          )}

          {song && <p className="now-playing">Now showing: <b>{song.title}</b></p>}
          <FallingNotes
            song={song}
            prefs={prefs.player}
            onPrefsChange={(p) => update({ player: p })}
            emptyMessage={
              prefs.source === 'betacustic'
                ? 'Load your Betacustic .mid above, or try a warm-up version.'
                : prefs.source === 'other'
                  ? 'Load a .mid file above.'
                  : ''
            }
          />
        </section>

        <section aria-label="Recordings" className="rec-grid">
          <Recorder onSave={(b, d) => void handleSaveTake(b, d)} />
          {takesErr && <p className="error">{takesErr}</p>}
          <TakesList
            takes={takes}
            onDelete={(id) => void deleteTake(id).then(refreshTakes)}
            onUpdateNotes={(id, text) => void updateTakeNotes(id, text).then(refreshTakes)}
          />
        </section>
      </main>

      <footer className="footer">
        <p>
          Recordings, MIDI files and saved sections stay in this browser (IndexedDB / localStorage). The tutorial is
          embedded from YouTube and never downloaded. Warm-up arrangements are original; the Betacustic arrangement
          plays only from the MIDI file you load.
        </p>
      </footer>
    </div>
  )
}
