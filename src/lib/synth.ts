/**
 * Tiny WebAudio "piano-ish" synth — no samples. Shares the AudioContext used by the
 * Loop gap beeps (loopCue.ts), which is unlocked on the first tap for Safari.
 */
import { getAudioContext } from './loopCue'
import { midiToFreq } from './music'

interface Voice {
  oscs: OscillatorNode[]
  amp: GainNode
  filter: BiquadFilterNode
  endAt: number
}

let master: GainNode | null = null
let masterCtx: AudioContext | null = null
const voices = new Set<Voice>()

function out(ctx: AudioContext): GainNode {
  if (master && masterCtx === ctx) return master
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.knee.value = 12
  comp.ratio.value = 4
  comp.attack.value = 0.003
  comp.release.value = 0.2
  master = ctx.createGain()
  master.gain.value = 0.55
  master.connect(comp)
  comp.connect(ctx.destination)
  masterCtx = ctx
  return master
}

export function audioNow(): number {
  return getAudioContext()?.currentTime ?? performance.now() / 1000
}

export function setVolume(v: number): void {
  const ctx = getAudioContext()
  if (!ctx) return
  out(ctx).gain.value = Math.max(0, Math.min(1, v)) * 0.8
}

/**
 * Schedule a note. `when` is AudioContext time. `dur` seconds (0 = hold until noteOff).
 * Returns a handle usable with releaseVoice().
 */
export function playNote(midi: number, when: number, dur: number, velocity = 0.7): Voice | null {
  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return null
  const f = midiToFreq(midi)
  const t0 = Math.max(when, ctx.currentTime)
  const vel = Math.max(0.05, Math.min(1, velocity))
  // Lower notes ring longer; higher notes decay faster (like a real piano).
  const lowness = Math.max(0, Math.min(1, (84 - midi) / 48))
  const tau = 0.35 + lowness * 1.3
  const peak = 0.22 * vel * (0.8 + lowness * 0.4)

  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.linearRampToValueAtTime(peak, t0 + 0.006)
  amp.gain.setTargetAtTime(peak * 0.35, t0 + 0.006, 0.12)
  amp.gain.setTargetAtTime(0.0001, t0 + 0.25, tau)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 0.7
  const bright = Math.min(12000, f * (6 + vel * 6))
  filter.frequency.setValueAtTime(bright, t0)
  filter.frequency.setTargetAtTime(Math.min(8000, f * 2.2), t0 + 0.01, 0.35)

  const partials: [OscillatorType, number, number, number][] = [
    // type, freq multiple, gain, detune cents
    ['triangle', 1, 1.0, 0],
    ['sine', 2, 0.35, 3],
    ['sawtooth', 1, 0.12, -4],
    ['sine', 3, 0.08, 0],
  ]
  const oscs: OscillatorNode[] = []
  for (const [type, mult, g, cents] of partials) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f * mult
    o.detune.value = cents
    const pg = ctx.createGain()
    pg.gain.value = g
    o.connect(pg)
    pg.connect(filter)
    o.start(t0)
    oscs.push(o)
  }
  filter.connect(amp)
  amp.connect(out(ctx))

  const voice: Voice = { oscs, amp, filter, endAt: Number.POSITIVE_INFINITY }
  voices.add(voice)
  oscs[0].onended = () => {
    voices.delete(voice)
    try {
      amp.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (dur > 0) releaseVoice(voice, t0 + dur)
  else {
    // Safety: never ring forever.
    for (const o of oscs) o.stop(t0 + 8)
  }
  return voice
}

export function releaseVoice(voice: Voice | null, at?: number): void {
  const ctx = getAudioContext()
  if (!voice || !ctx) return
  const t = Math.max(at ?? ctx.currentTime, ctx.currentTime)
  voice.endAt = t
  try {
    voice.amp.gain.cancelScheduledValues(t)
    // Keep the current envelope value, then damp quickly (key released).
    voice.amp.gain.setTargetAtTime(0.0001, t, 0.07)
    for (const o of voice.oscs) {
      try {
        o.stop(t + 0.5)
      } catch {
        /* already scheduled */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Silence everything now (Pause / Stop / seek). */
export function stopAllNotes(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  for (const v of voices) {
    try {
      v.amp.gain.cancelScheduledValues(now)
      v.amp.gain.setTargetAtTime(0.0001, now, 0.03)
      for (const o of v.oscs) {
        try {
          o.stop(now + 0.2)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  voices.clear()
}
