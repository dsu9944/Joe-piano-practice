import { useRef, useState } from 'react'
import type { StoredMidi } from '../lib/storage'
import type { MidiInfo, SplitMode } from '../lib/midiImport'

interface Props {
  stored: StoredMidi | null
  info: MidiInfo | null
  error: string | null
  split: SplitMode
  onSplit: (s: SplitMode) => void
  onLoad: (file: File) => void
  onRemove: () => void
  buttonLabel: string
}

export function MidiSlot({ stored, info, error, split, onSplit, onLoad, onRemove, buttonLabel }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="midi-slot-body">
      <div className="recorder-actions">
        <label className={`btn primary upload-btn${busy ? ' is-disabled' : ''}`}>
          {stored ? '↻ Replace MIDI file' : buttonLabel}
          <input
            ref={inputRef}
            type="file"
            /* No accept filter: iOS Files can grey out .mid files when one is set. We check the header instead. */
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setBusy(true)
              Promise.resolve(onLoad(f)).finally(() => {
                setBusy(false)
                if (inputRef.current) inputRef.current.value = ''
              })
            }}
          />
        </label>
        {stored && (
          <button type="button" className="btn ghost" onClick={() => window.confirm('Remove this MIDI file from this device?') && onRemove()}>
            Remove
          </button>
        )}
        <label className="check inline">
          Hand split:&nbsp;
          <select value={split} onChange={(e) => onSplit(e.target.value as SplitMode)}>
            <option value="auto">Auto</option>
            <option value="tracks">By track</option>
            <option value="pitch">By pitch (middle C)</option>
          </select>
        </label>
      </div>
      {stored && (
        <p className="midi-status" role="status">
          ✅ <b>{stored.fileName}</b> — saved on this device
          {info && (
            <>
              {' · '}
              {info.usedMode === 'tracks'
                ? `hands by track (${info.tracks.map((t) => `${t.name}: ${t.hand === 'R' ? 'RH' : 'LH'}`).join(', ')})`
                : 'hands split at middle C'}
            </>
          )}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
