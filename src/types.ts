export type Hand = 'R' | 'L'

/** One note in a falling-notes song. Times are seconds at 100% tempo. */
export interface SongNote {
  midi: number
  start: number
  dur: number
  hand: Hand
  velocity?: number
  /** True for the tune's melody note (used by unit checks / display). */
  melody?: boolean
}

/** A loopable chunk (line / group of bars). Seconds at 100% tempo. */
export interface SongSection {
  label: string
  start: number
  end: number
}

export interface Song {
  id: string
  title: string
  notes: SongNote[]
  /** Bar start times (seconds). bars[0] = first bar (may be a pickup). */
  bars: number[]
  /** Label for bars[i] (e.g. "Pickup", "1", "2"). */
  barLabels: string[]
  sections: SongSection[]
  duration: number
  /** Beats per minute at 100%, for display. */
  bpm?: number
}

export interface Take {
  id: string
  songLabel: string
  createdAt: number
  durationMs: number
  blob: Blob
  notes: string
}
