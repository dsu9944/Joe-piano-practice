import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Hand, Song } from '../types'
import { cancelLoopCueBeeps, getAudioContext, scheduleLoopGapBeeps, unlockLoopCueAudio } from '../lib/loopCue'
import { isBlack, noteName } from '../lib/music'
import { playNote, releaseVoice, stopAllNotes } from '../lib/synth'

type HandMode = 'both' | 'R' | 'L'

export interface PlayerPrefs {
  tempo: number
  handMode: HandMode
  hideMuted: boolean
  showNames: boolean
  loop: boolean
  waitEachLine: boolean
}

interface Props {
  song: Song | null
  prefs: PlayerPrefs
  onPrefsChange: (p: PlayerPrefs) => void
  /** Shown over the canvas when there is no song. */
  emptyMessage?: string
}

const COLORS: Record<Hand, { white: string; black: string; key: string }> = {
  R: { white: '#3fbfa4', black: '#2b8f7b', key: '#6fe0c6' },
  L: { white: '#f2a44e', black: '#c97a2a', key: '#ffc27d' },
}
const LOOP_GAP_MS = 3000
/** Seconds of song time visible above the keyboard. */
const WINDOW_SEC = 3.2
const LEAD_IN_SEC = 1.5
const LOOKAHEAD_SEC = 0.25

interface KeyGeom {
  x: number
  w: number
  black: boolean
}

function keyRange(song: Song | null): [number, number] {
  let lo = 48 // C3
  let hi = 84 // C6
  if (song) {
    for (const n of song.notes) {
      if (n.midi < lo) lo = n.midi
      if (n.midi > hi) hi = n.midi
    }
  }
  lo = Math.max(21, lo - (((lo % 12) + 12) % 12)) // down to a C (or A0)
  hi = Math.min(108, hi + ((12 - (hi % 12)) % 12)) // up to a C (or C8)
  return [lo, hi]
}

function layoutKeys(lo: number, hi: number, width: number): Map<number, KeyGeom> {
  const whites: number[] = []
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m)
  const ww = width / whites.length
  const bw = ww * 0.62
  const map = new Map<number, KeyGeom>()
  whites.forEach((m, i) => map.set(m, { x: i * ww, w: ww, black: false }))
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) continue
    const right = map.get(m + 1)
    const left = map.get(m - 1)
    const edge = right ? right.x : left ? left.x + left.w : 0
    map.set(m, { x: edge - bw / 2, w: bw, black: true })
  }
  return map
}

function fmtTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.lineTo(x + w - rr, y)
  g.quadraticCurveTo(x + w, y, x + w, y + rr)
  g.lineTo(x + w, y + h - rr)
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  g.lineTo(x + rr, y + h)
  g.quadraticCurveTo(x, y + h, x, y + h - rr)
  g.lineTo(x, y + rr)
  g.quadraticCurveTo(x, y, x + rr, y)
  g.closePath()
}

export function FallingNotes({ song, prefs, onPrefsChange, emptyMessage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pausedForGap, setPausedForGap] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [displayPos, setDisplayPos] = useState(0)
  /** '' = whole song, 's:<i>' = section, 'bars' = custom bar range */
  const [regionKey, setRegionKey] = useState('')
  const [barFrom, setBarFrom] = useState(0)
  const [barTo, setBarTo] = useState(3)

  const set = <K extends keyof PlayerPrefs>(k: K, v: PlayerPrefs[K]) => onPrefsChange({ ...prefs, [k]: v })

  // ---- engine state (refs; the rAF loop reads these) ----
  const songRef = useRef(song)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const posRef = useRef(-LEAD_IN_SEC)
  const playingRef = useRef(false)
  const anchorRef = useRef({ songT: 0, perfT: 0 })
  const nextIdxRef = useRef(0)
  const gapTimerRef = useRef<number | null>(null)
  const touchVoicesRef = useRef(new Map<number, ReturnType<typeof playNote>>())
  const touchKeysRef = useRef(new Set<number>())
  const lastUiRef = useRef(0)

  const [lo, hi] = useMemo(() => keyRange(song), [song])

  const region = useMemo(() => {
    const dur = song?.duration ?? 0
    if (!song) return { start: 0, end: 0, label: 'Whole song' }
    if (regionKey.startsWith('s:')) {
      const s = song.sections[Number(regionKey.slice(2))]
      if (s) return { start: s.start, end: s.end, label: s.label }
    }
    if (regionKey === 'bars' && song.bars.length) {
      const a = Math.max(0, Math.min(barFrom, song.bars.length - 1))
      const b = Math.max(a, Math.min(barTo, song.bars.length - 1))
      const end = b + 1 < song.bars.length ? song.bars[b + 1] : dur
      return { start: song.bars[a], end, label: `Bars ${song.barLabels[a]}–${song.barLabels[b]}` }
    }
    return { start: 0, end: dur, label: 'Whole song' }
  }, [song, regionKey, barFrom, barTo])
  const regionRef = useRef(region)
  regionRef.current = region

  const songTimeNow = useCallback(() => {
    if (!playingRef.current) return posRef.current
    const a = anchorRef.current
    return a.songT + ((performance.now() - a.perfT) / 1000) * prefsRef.current.tempo
  }, [])

  const firstIdxAtOrAfter = (t: number) => {
    const notes = songRef.current?.notes ?? []
    let lo2 = 0
    let hi2 = notes.length
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1
      if (notes[mid].start < t - 1e-4) lo2 = mid + 1
      else hi2 = mid
    }
    return lo2
  }

  const anchorAt = (t: number) => {
    anchorRef.current = { songT: t, perfT: performance.now() }
    nextIdxRef.current = firstIdxAtOrAfter(t)
  }

  const clearGap = () => {
    if (gapTimerRef.current != null) {
      window.clearTimeout(gapTimerRef.current)
      gapTimerRef.current = null
    }
    cancelLoopCueBeeps()
    setPausedForGap(false)
  }

  const pause = useCallback(() => {
    posRef.current = songTimeNow()
    playingRef.current = false
    setPlaying(false)
    stopAllNotes()
    clearGap()
    setDisplayPos(posRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songTimeNow])

  const startFrom = (t: number) => {
    setWaiting(false)
    posRef.current = t
    anchorAt(t)
    playingRef.current = true
    setPlaying(true)
  }

  const play = async () => {
    if (!songRef.current) return
    await unlockLoopCueAudio()
    clearGap()
    const r = regionRef.current
    let t = posRef.current
    if (t < r.start - LEAD_IN_SEC - 0.01 || t >= r.end - 0.05) t = r.start - LEAD_IN_SEC
    startFrom(t)
  }

  const seek = (t: number) => {
    stopAllNotes()
    clearGap()
    setWaiting(false)
    posRef.current = t
    if (playingRef.current) anchorAt(t)
    setDisplayPos(t)
  }

  // Song changed → reset.
  useEffect(() => {
    songRef.current = song
    playingRef.current = false
    setPlaying(false)
    setWaiting(false)
    stopAllNotes()
    clearGap()
    setRegionKey('')
    setBarFrom(0)
    setBarTo(Math.min(3, Math.max(0, (song?.bars.length ?? 1) - 1)))
    posRef.current = -LEAD_IN_SEC
    setDisplayPos(-LEAD_IN_SEC)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  // Region changed → park at its start.
  useEffect(() => {
    if (!songRef.current) return
    const wasPlaying = playingRef.current
    stopAllNotes()
    clearGap()
    setWaiting(false)
    posRef.current = region.start - LEAD_IN_SEC
    if (wasPlaying) anchorAt(posRef.current)
    setDisplayPos(posRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.start, region.end])

  // Tempo changed mid-play → re-anchor so the song position doesn't jump.
  const lastTempoRef = useRef(prefs.tempo)
  useEffect(() => {
    if (lastTempoRef.current === prefs.tempo) return
    if (playingRef.current) {
      const a = anchorRef.current
      const t = a.songT + ((performance.now() - a.perfT) / 1000) * lastTempoRef.current
      anchorRef.current = { songT: t, perfT: performance.now() }
    }
    lastTempoRef.current = prefs.tempo
  }, [prefs.tempo])

  // Cleanup on unmount
  useEffect(
    () => () => {
      playingRef.current = false
      stopAllNotes()
      clearGap()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ---- main animation loop: schedule audio + draw ----
  useEffect(() => {
    let raf = 0
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const s = songRef.current
      const p = prefsRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)

      let t = songTimeNow()
      const r = regionRef.current

      // ---- transport logic ----
      if (s && playingRef.current) {
        const notes = s.notes
        // Pause at the end of each line (wait mode)
        if (p.waitEachLine && !p.loop) {
          const prev = lastUiRef.current
          const boundary = s.sections.find((sec) => sec.end < s.duration - 0.01 && prev < sec.end && t >= sec.end)
          if (boundary) {
            posRef.current = boundary.end
            playingRef.current = false
            setPlaying(false)
            setWaiting(true)
            t = boundary.end
          }
        }
        if (playingRef.current && t >= r.end) {
          if (p.loop) {
            // Loop gap: 3 beeps (0/1/2 s), restart at region start at 3 s.
            playingRef.current = false
            posRef.current = r.start
            t = r.start
            setPausedForGap(true)
            void scheduleLoopGapBeeps()
            gapTimerRef.current = window.setTimeout(() => {
              gapTimerRef.current = null
              setPausedForGap(false)
              startFrom(regionRef.current.start)
            }, LOOP_GAP_MS)
          } else if (t >= r.end + 0.8) {
            posRef.current = r.end
            playingRef.current = false
            setPlaying(false)
            t = r.end
          }
        }
        // Schedule notes in the lookahead window
        if (playingRef.current) {
          const ctx = getAudioContext()
          while (nextIdxRef.current < notes.length) {
            const n = notes[nextIdxRef.current]
            if (n.start > t + LOOKAHEAD_SEC * p.tempo) break
            nextIdxRef.current++
            if (n.start < t - 0.05 || n.start >= r.end) continue
            const audible = p.handMode === 'both' || p.handMode === n.hand
            if (!audible || !ctx) continue
            const delaySec = (n.start - t) / p.tempo
            const when = ctx.currentTime + Math.max(0, delaySec) + 0.02
            const d = Math.min(n.dur, Math.max(0.05, r.end - n.start)) / p.tempo
            playNote(n.midi, when, d, n.velocity ?? 0.7)
          }
        }
      }
      lastUiRef.current = t

      // ---- draw ----
      const W = cssW
      const H = cssH
      const keyH = Math.max(64, Math.min(150, H * 0.22))
      const keyTop = H - keyH
      const pps = keyTop / WINDOW_SEC
      const [klo, khi] = keyRange(s)
      const keys = layoutKeys(klo, khi, W)

      g.fillStyle = '#18242a'
      g.fillRect(0, 0, W, keyTop)
      // octave guide lines at each C / F
      for (let m = klo; m <= khi; m++) {
        const k = keys.get(m)
        if (!k || k.black) continue
        const pc = m % 12
        if (pc === 0 || pc === 5) {
          g.fillStyle = pc === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)'
          g.fillRect(Math.round(k.x), 0, 1, keyTop)
        }
      }
      // loop region shading
      if (s && (regionKey !== '' || p.loop)) {
        const yEnd = keyTop - (r.end - t) * pps
        const yStart = keyTop - (r.start - t) * pps
        g.fillStyle = 'rgba(63,191,164,0.06)'
        g.fillRect(0, Math.max(0, yEnd), W, Math.min(keyTop, yStart) - Math.max(0, yEnd))
        if (yEnd > 0 && yEnd < keyTop) {
          g.fillStyle = 'rgba(111,224,198,0.55)'
          g.fillRect(0, yEnd, W, 2)
        }
      }
      if (s) {
        // bar lines + labels
        g.font = '600 11px system-ui, sans-serif'
        g.textBaseline = 'bottom'
        for (let i = 0; i < s.bars.length; i++) {
          const y = keyTop - (s.bars[i] - t) * pps
          if (y < -2 || y > keyTop) continue
          g.fillStyle = 'rgba(255,255,255,0.12)'
          g.fillRect(0, y, W, 1)
          g.fillStyle = 'rgba(255,255,255,0.45)'
          g.fillText(s.barLabels[i], 6, y - 2)
        }
        // falling notes (white-key notes first, then black on top)
        const notes = s.notes
        const startI = Math.max(0, firstIdxAtOrAfter(t - 8))
        const active = new Map<number, Hand>()
        for (const pass of [false, true]) {
          for (let i = startI; i < notes.length; i++) {
            const n = notes[i]
            if (n.start > t + WINDOW_SEC) break
            if (n.start + n.dur < t) continue
            const k = keys.get(n.midi)
            if (!k || k.black !== pass) continue
            const muted = !(p.handMode === 'both' || p.handMode === n.hand)
            if (muted && p.hideMuted) continue
            const yBottom = keyTop - (n.start - t) * pps
            const yTop = keyTop - (n.start + n.dur - t) * pps
            const h = Math.max(4, yBottom - yTop - 2)
            const c = COLORS[n.hand]
            g.globalAlpha = muted ? 0.22 : 1
            const pad = Math.max(1, k.w * 0.08)
            roundRect(g, k.x + pad, yTop, k.w - pad * 2, h, 5)
            g.fillStyle = k.black ? c.black : c.white
            g.fill()
            g.strokeStyle = 'rgba(0,0,0,0.25)'
            g.lineWidth = 1
            g.stroke()
            if (p.showNames && h > 16 && k.w > 13) {
              g.fillStyle = 'rgba(10,25,30,0.85)'
              g.font = `700 ${Math.min(13, k.w * 0.5)}px system-ui, sans-serif`
              g.textAlign = 'center'
              g.textBaseline = 'bottom'
              g.fillText(noteName(n.midi, false), k.x + k.w / 2, yBottom - 4)
              g.textAlign = 'left'
            }
            g.globalAlpha = 1
            if (!muted && n.start <= t && n.start + n.dur > t) active.set(n.midi, n.hand)
          }
        }
        drawKeyboard(g, keys, klo, khi, keyTop, keyH, active, touchKeysRef.current)
      } else {
        drawKeyboard(g, keys, klo, khi, keyTop, keyH, new Map(), touchKeysRef.current)
      }
      // hit line
      const grad = g.createLinearGradient(0, keyTop - 6, 0, keyTop)
      grad.addColorStop(0, 'rgba(111,224,198,0)')
      grad.addColorStop(1, 'rgba(111,224,198,0.6)')
      g.fillStyle = grad
      g.fillRect(0, keyTop - 6, W, 6)

      // throttle React UI updates
      const now = performance.now()
      if (now - lastUiTickRef.current > 120) {
        lastUiTickRef.current = now
        setDisplayPos(t)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey])
  const lastUiTickRef = useRef(0)

  // ---- touch / click the on-screen keys to hear them ----
  const keyAt = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const H = rect.height
    const keyH = Math.max(64, Math.min(150, H * 0.22))
    const keyTop = H - keyH
    if (y < keyTop) return null
    const keys = layoutKeys(lo, hi, rect.width)
    const blackBottom = keyTop + keyH * 0.62
    if (y <= blackBottom) {
      for (const [m, k] of keys) if (k.black && x >= k.x && x <= k.x + k.w) return m
    }
    for (const [m, k] of keys) if (!k.black && x >= k.x && x <= k.x + k.w) return m
    return null
  }

  const onPointerDown = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = keyAt(e.clientX, e.clientY)
    if (m == null) return
    e.preventDefault()
    await unlockLoopCueAudio()
    const ctx = getAudioContext()
    if (!ctx) return
    touchKeysRef.current.add(m)
    touchVoicesRef.current.set(e.pointerId, playNote(m, ctx.currentTime, 0, 0.75))
    ;(e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId)
    pointerKeyRef.current.set(e.pointerId, m)
  }
  const pointerKeyRef = useRef(new Map<number, number>())
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = touchVoicesRef.current.get(e.pointerId)
    if (v) releaseVoice(v)
    touchVoicesRef.current.delete(e.pointerId)
    const m = pointerKeyRef.current.get(e.pointerId)
    if (m != null) touchKeysRef.current.delete(m)
    pointerKeyRef.current.delete(e.pointerId)
  }

  const dur = song?.duration ?? 0
  const curBar = useMemo(() => {
    if (!song || !song.bars.length) return ''
    let i = 0
    while (i + 1 < song.bars.length && song.bars[i + 1] <= displayPos + 1e-3) i++
    return displayPos < song.bars[0] ? '—' : song.barLabels[i]
  }, [song, displayPos])

  const handBtn = (mode: HandMode, label: string) => (
    <button
      type="button"
      className={`seg${prefs.handMode === mode ? ' on' : ''}`}
      aria-pressed={prefs.handMode === mode}
      onClick={() => set('handMode', mode)}
    >
      {label}
    </button>
  )

  return (
    <div className="falling">
      <div className="falling-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="falling-canvas"
          onPointerDown={(e) => void onPointerDown(e)}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Falling notes view with keyboard"
        />
        {!song && emptyMessage && <div className="falling-empty">{emptyMessage}</div>}
        {pausedForGap && <div className="falling-badge">Loop — get ready… 3 beeps</div>}
        {waiting && (
          <button type="button" className="falling-continue btn primary large" onClick={() => void (async () => {
            await unlockLoopCueAudio()
            startFrom(posRef.current)
          })()}>
            End of line — Continue ▶
          </button>
        )}
      </div>

      <div className="legend">
        <span><i className="dot rh" /> Right hand</span>
        <span><i className="dot lh" /> Left hand</span>
        <span className="hint">Tap the keys to hear a note.</span>
      </div>

      <div className="transport">
        {playing || pausedForGap ? (
          <button type="button" className="btn danger large" onClick={pause}>⏸ Pause</button>
        ) : (
          <button type="button" className="btn primary large" onClick={() => void play()} disabled={!song}>▶ Play</button>
        )}
        <button type="button" className="btn ghost" disabled={!song} onClick={() => seek(region.start - LEAD_IN_SEC)}>
          ⏮ Back to start
        </button>
        <span className="pos-readout" aria-live="off">
          Bar {curBar} · {fmtTime(displayPos)} / {fmtTime(dur)}
        </span>
      </div>
      <input
        type="range"
        className="scrubber"
        min={-LEAD_IN_SEC}
        max={Math.max(0.1, dur)}
        step={0.05}
        value={Math.min(dur, displayPos)}
        disabled={!song}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Song position"
      />

      <div className="controls-grid">
        <label className="ctl">
          <span>Tempo <b>{Math.round(prefs.tempo * 100)}%</b>{song?.bpm ? ` (≈${Math.round(song.bpm * prefs.tempo)} bpm)` : ''}</span>
          <input type="range" min={40} max={120} step={5} value={Math.round(prefs.tempo * 100)} onChange={(e) => set('tempo', Number(e.target.value) / 100)} />
        </label>
        <div className="ctl">
          <span>Hands</span>
          <div className="segs" role="group" aria-label="Hands">
            {handBtn('both', 'Both')}
            {handBtn('R', 'RH only')}
            {handBtn('L', 'LH only')}
          </div>
          <label className="check">
            <input type="checkbox" checked={prefs.hideMuted} onChange={(e) => set('hideMuted', e.target.checked)} /> Hide the other hand (default: shown faded, silent)
          </label>
        </div>
        <div className="ctl">
          <span>Practise</span>
          <select className="piece-select small" value={regionKey} onChange={(e) => setRegionKey(e.target.value)} disabled={!song}>
            <option value="">Whole piece</option>
            {song?.sections.map((s, i) => (
              <option key={i} value={`s:${i}`}>{s.label}</option>
            ))}
            <option value="bars">Choose bars…</option>
          </select>
          {regionKey === 'bars' && song && (
            <div className="bar-pick">
              Bars
              <select value={barFrom} onChange={(e) => { const v = Number(e.target.value); setBarFrom(v); if (barTo < v) setBarTo(v) }}>
                {song.barLabels.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
              to
              <select value={barTo} onChange={(e) => setBarTo(Number(e.target.value))}>
                {song.barLabels.map((l, i) => <option key={i} value={i} disabled={i < barFrom}>{l}</option>)}
              </select>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={prefs.loop} onChange={(e) => set('loop', e.target.checked)} /> Loop it (3-beep countdown between repeats)
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.waitEachLine} disabled={prefs.loop} onChange={(e) => set('waitEachLine', e.target.checked)} /> Wait at the end of each line
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.showNames} onChange={(e) => set('showNames', e.target.checked)} /> Show note names
          </label>
        </div>
      </div>
    </div>
  )
}

function drawKeyboard(
  g: CanvasRenderingContext2D,
  keys: Map<number, KeyGeom>,
  lo: number,
  hi: number,
  top: number,
  h: number,
  active: Map<number, Hand>,
  touched: Set<number>,
) {
  g.fillStyle = '#0e1518'
  g.fillRect(0, top, 100000, h)
  for (let m = lo; m <= hi; m++) {
    const k = keys.get(m)
    if (!k || k.black) continue
    const hand = active.get(m)
    g.fillStyle = hand ? COLORS[hand].key : touched.has(m) ? '#cfe9e3' : '#fbfaf6'
    roundRect(g, k.x + 0.5, top + 1, k.w - 1, h - 2, 4)
    g.fill()
    if (m % 12 === 0) {
      g.fillStyle = 'rgba(40,50,60,0.55)'
      g.font = `600 ${Math.max(8, Math.min(11, k.w * 0.45))}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'bottom'
      g.fillText(noteName(m), k.x + k.w / 2, top + h - 4)
      g.textAlign = 'left'
    }
  }
  const bh = h * 0.62
  for (let m = lo; m <= hi; m++) {
    const k = keys.get(m)
    if (!k || !k.black) continue
    const hand = active.get(m)
    g.fillStyle = hand ? COLORS[hand].black : touched.has(m) ? '#3d6b7a' : '#1c2328'
    roundRect(g, k.x, top, k.w, bh, 3)
    g.fill()
  }
}
