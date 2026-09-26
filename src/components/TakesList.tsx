import { useEffect, useMemo, useState } from 'react'
import type { Take } from '../types'
import { downloadBlob, extensionForAudioMime } from '../lib/audioMime'

interface Props {
  takes: Take[]
  onDelete: (id: string) => void
  onUpdateNotes: (id: string, text: string) => void
}

const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function TakeRow({ take, onDelete, onUpdateNotes }: { take: Take } & Omit<Props, 'takes'>) {
  const url = useMemo(() => URL.createObjectURL(take.blob), [take.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [notes, setNotes] = useState(take.notes)
  return (
    <li className="take-item">
      <div className="take-head">
        <strong>{take.songLabel}</strong>
        <span className="hint inline-hint">{fmtWhen(take.createdAt)} · {fmtDur(take.durationMs)}</span>
      </div>
      <audio controls preload="metadata" src={url} />
      <div className="take-actions">
        <input
          className="text-input"
          placeholder="Notes (e.g. bar 5 still rushed)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== take.notes && onUpdateNotes(take.id, notes)}
        />
        <button type="button" className="btn tiny ghost" onClick={() => downloadBlob(take.blob, `joe-piano-${take.createdAt}.${extensionForAudioMime(take.blob.type)}`)}>
          ⬇ Save file
        </button>
        <button type="button" className="btn tiny danger" onClick={() => window.confirm('Delete this take?') && onDelete(take.id)}>
          Delete
        </button>
      </div>
    </li>
  )
}

export function TakesList({ takes, onDelete, onUpdateNotes }: Props) {
  return (
    <div className="card">
      <h2>My takes</h2>
      {takes.length === 0 ? (
        <p className="hint">No recordings yet. Record a take above and listen back.</p>
      ) : (
        <ul className="takes-list">
          {takes.map((t) => (
            <TakeRow key={t.id} take={t} onDelete={onDelete} onUpdateNotes={onUpdateNotes} />
          ))}
        </ul>
      )}
    </div>
  )
}
