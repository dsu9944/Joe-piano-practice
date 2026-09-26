import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cancelLoopCueBeeps, scheduleLoopGapBeeps, unlockLoopCueAudio } from '../lib/loopCue'
import { loadVideoSections, saveVideoSections, type VideoSection } from '../lib/storage'

interface Props {
  youtubeId: string
  title: string
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        config: {
          videoId: string
          playerVars?: Record<string, number | string>
          events?: {
            onReady?: (e: { target: YtPlayer }) => void
            onStateChange?: (e: { data: number; target: YtPlayer }) => void
          }
        },
      ) => YtPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YtPlayer {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  cueVideoById: (videoId: string) => void
  setPlaybackRate: (rate: number) => void
  destroy: () => void
}

const SPEEDS = [0.25, 0.5, 0.75, 1] as const
const LOOP_GAP_MS = 3000

let apiLoadPromise: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiLoadPromise) return apiLoadPromise
  apiLoadPromise = new Promise((resolve) => {
    const prior = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prior?.()
      resolve()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
    if (window.YT?.Player) resolve()
  })
  return apiLoadPromise
}

function fmt(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function TutorialVideo({ youtubeId, title }: Props) {
  const reactId = useId().replace(/:/g, '')
  const containerId = `yt-player-${reactId}`
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const youtubeIdRef = useRef(youtubeId)
  youtubeIdRef.current = youtubeId

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const [speed, setSpeed] = useState<number>(1)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [loop, setLoop] = useState(true)
  const [abActive, setAbActive] = useState(false)
  const [gap, setGap] = useState(false)
  const [sections, setSections] = useState<VideoSection[]>(() => loadVideoSections())
  const [name, setName] = useState('')

  const abRef = useRef({ a, b, loop, abActive })
  abRef.current = { a, b, loop, abActive }
  const gapTimerRef = useRef<number | null>(null)

  const getTime = useCallback(() => {
    try {
      return playerRef.current?.getCurrentTime() ?? 0
    } catch {
      return 0
    }
  }, [])

  const clearGap = () => {
    if (gapTimerRef.current != null) {
      window.clearTimeout(gapTimerRef.current)
      gapTimerRef.current = null
    }
    cancelLoopCueBeeps()
    setGap(false)
  }

  // Mount the player once (stable host + fresh inner div, as in the Alexia app).
  useEffect(() => {
    let cancelled = false
    const ensureMountEl = (): HTMLElement | null => {
      const host = hostRef.current
      if (!host) return null
      let el = document.getElementById(containerId)
      if (el && host.contains(el)) return el
      host.replaceChildren()
      el = document.createElement('div')
      el.id = containerId
      host.appendChild(el)
      return el
    }
    void (async () => {
      try {
        await loadYouTubeApi()
        if (cancelled || !window.YT) return
        const el = ensureMountEl()
        if (!el) return
        playerRef.current = new window.YT.Player(el, {
          videoId: youtubeIdRef.current,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1, origin: window.location.origin },
          events: {
            onReady: (e) => {
              const wanted = youtubeIdRef.current
              try {
                e.target.cueVideoById(wanted)
              } catch {
                /* ignore */
              }
              setReady(true)
              setError(null)
            },
            onStateChange: (e) => setPlaying(e.data === window.YT?.PlayerState.PLAYING),
          },
        })
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Could not load YouTube. Check the connection and refresh.')
      }
    })()
    return () => {
      cancelled = true
      clearGap()
      try {
        playerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId])

  // Apply speed whenever it changes (and after the player is ready / starts playing).
  useEffect(() => {
    if (!ready) return
    try {
      playerRef.current?.setPlaybackRate(speed)
    } catch {
      /* ignore */
    }
  }, [speed, ready, playing])

  // Clock + A/B watcher
  useEffect(() => {
    if (!ready) return
    const id = window.setInterval(() => {
      const t = getTime()
      setNow(t)
      const { a: A, b: B, loop: L, abActive: act } = abRef.current
      if (!act || A == null || B == null || gapTimerRef.current != null) return
      if (t >= B - 0.05) {
        playerRef.current?.pauseVideo()
        if (L) {
          setGap(true)
          void scheduleLoopGapBeeps()
          gapTimerRef.current = window.setTimeout(() => {
            gapTimerRef.current = null
            setGap(false)
            if (!abRef.current.abActive) return
            playerRef.current?.seekTo(abRef.current.a ?? 0, true)
            playerRef.current?.playVideo()
          }, LOOP_GAP_MS)
        } else {
          setAbActive(false)
        }
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [ready, getTime])

  const play = () => {
    void unlockLoopCueAudio()
    playerRef.current?.playVideo()
  }
  const pause = () => {
    setAbActive(false)
    clearGap()
    playerRef.current?.pauseVideo()
  }
  const skip = (d: number) => playerRef.current?.seekTo(Math.max(0, getTime() + d), true)

  const playAB = async (A = a, B = b) => {
    if (A == null || B == null || B <= A) return
    await unlockLoopCueAudio()
    clearGap()
    setAbActive(true)
    abRef.current = { ...abRef.current, a: A, b: B, abActive: true }
    playerRef.current?.seekTo(A, true)
    playerRef.current?.playVideo()
  }

  const nudge = (which: 'a' | 'b', d: number) => {
    if (which === 'a') setA((v) => (v == null ? v : Math.max(0, +(v + d).toFixed(2))))
    else setB((v) => (v == null ? v : Math.max(0, +(v + d).toFixed(2))))
  }

  const persist = (list: VideoSection[]) => {
    setSections(list)
    saveVideoSections(list)
  }

  const saveSection = () => {
    if (a == null || b == null || b <= a) return
    const label = name.trim() || `Section ${sections.length + 1}`
    persist([...sections, { id: newId(), name: label, start: a, end: b }].sort((x, y) => x.start - y.start))
    setName('')
  }

  const abValid = a != null && b != null && b > a

  return (
    <div className="tutorial">
      <div className="video-frame big">
        <div ref={hostRef} className="yt-host">
          <div id={containerId} title={`YouTube: ${title}`} />
        </div>
      </div>

      <div className="yt-controls" role="group" aria-label="Video playback">
        {playing ? (
          <button type="button" className="btn danger" onClick={pause} disabled={!ready}>⏸ Pause</button>
        ) : (
          <button type="button" className="btn primary" onClick={play} disabled={!ready}>▶ Play</button>
        )}
        <button type="button" className="btn ghost" onClick={() => skip(-5)} disabled={!ready}>⏪ 5s</button>
        <button type="button" className="btn ghost" onClick={() => skip(5)} disabled={!ready}>5s ⏩</button>
        <span className="pos-readout">{fmt(now)}</span>
        <div className="segs" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={`seg${speed === s ? ' on' : ''}`} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="ab-box">
        <div className="ab-row">
          <button type="button" className="btn secondary" disabled={!ready} onClick={() => setA(+getTime().toFixed(2))}>Set start</button>
          <span className="ab-time">A {fmt(a)}</span>
          <button type="button" className="btn micro ghost" disabled={a == null} onClick={() => nudge('a', -0.5)} aria-label="Start 0.5 s earlier">−½s</button>
          <button type="button" className="btn micro ghost" disabled={a == null} onClick={() => nudge('a', 0.5)} aria-label="Start 0.5 s later">+½s</button>
          <span className="ab-sep" />
          <button type="button" className="btn secondary" disabled={!ready} onClick={() => setB(+getTime().toFixed(2))}>Set end</button>
          <span className="ab-time">B {fmt(b)}</span>
          <button type="button" className="btn micro ghost" disabled={b == null} onClick={() => nudge('b', -0.5)} aria-label="End 0.5 s earlier">−½s</button>
          <button type="button" className="btn micro ghost" disabled={b == null} onClick={() => nudge('b', 0.5)} aria-label="End 0.5 s later">+½s</button>
        </div>
        <div className="ab-row">
          {abActive || gap ? (
            <button type="button" className="btn danger" onClick={pause}>■ Stop section</button>
          ) : (
            <button type="button" className="btn primary" disabled={!ready || !abValid} onClick={() => void playAB()}>▶ Play A→B</button>
          )}
          <label className="check inline">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop (3 beeps between repeats)
          </label>
          {gap && <span className="gap-badge">Get ready… 🔔🔔🔔</span>}
        </div>
        {a != null && b != null && b <= a && <p className="hint">End must be after start.</p>}
        <div className="ab-row">
          <input className="text-input" placeholder="Name this section (e.g. Intro, Line 2)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button type="button" className="btn ghost" disabled={!abValid} onClick={saveSection}>💾 Save section</button>
        </div>
        {sections.length > 0 && (
          <ul className="saved-sections">
            {sections.map((s) => (
              <li key={s.id}>
                <button type="button" className="btn tiny primary" onClick={() => { setA(s.start); setB(s.end); void playAB(s.start, s.end) }}>▶</button>
                <button type="button" className="linkish" onClick={() => { setA(s.start); setB(s.end) }}>{s.name}</button>
                <span className="hint inline-hint">{fmt(s.start)} – {fmt(s.end)}</span>
                <button type="button" className="btn micro ghost" aria-label={`Delete ${s.name}`} onClick={() => persist(sections.filter((x) => x.id !== s.id))}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="hint small-print">
        Video plays from YouTube (embedded, never downloaded). Some speeds depend on YouTube support for this video.
      </p>
    </div>
  )
}
