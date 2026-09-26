/** On-device storage: IndexedDB for recordings + MIDI files, localStorage for small prefs. */
import type { Take } from '../types'
import { reviveAudioBlob } from './audioMime'

const DB_NAME = 'joe-piano-practice'
const DB_VERSION = 1
const TAKES = 'takes'
const MIDI = 'midi'

export type MidiSlot = 'betacustic' | 'other'

export interface StoredMidi {
  slot: MidiSlot
  fileName: string
  data: ArrayBuffer
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TAKES)) {
        const s = db.createObjectStore(TAKES, { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(MIDI)) {
        db.createObjectStore(MIDI, { keyPath: 'slot' })
      }
    }
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const s = t.objectStore(store)
        const req = fn(s)
        let result: T | undefined
        if (req) req.onsuccess = () => (result = req.result)
        t.oncomplete = () => {
          db.close()
          resolve(result)
        }
        t.onerror = () => {
          db.close()
          reject(t.error)
        }
        t.onabort = () => {
          db.close()
          reject(t.error)
        }
      }),
  )
}

// ---- Takes (recordings) ----

export async function saveTake(take: Take): Promise<void> {
  await tx(TAKES, 'readwrite', (s) => s.put(take))
}

export async function listTakes(): Promise<Take[]> {
  const rows = ((await tx<Take[]>(TAKES, 'readonly', (s) => s.getAll())) ?? []) as Take[]
  const out: Take[] = []
  for (const r of rows) {
    if (!r.blob || !(r.blob instanceof Blob) || r.blob.size === 0) continue
    let blob = r.blob
    try {
      blob = await reviveAudioBlob(r.blob)
    } catch {
      /* use as-is */
    }
    out.push({ ...r, blob, notes: r.notes ?? '' })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteTake(id: string): Promise<void> {
  await tx(TAKES, 'readwrite', (s) => s.delete(id))
}

export async function updateTakeNotes(id: string, notes: string): Promise<void> {
  const row = (await tx<Take>(TAKES, 'readonly', (s) => s.get(id))) as Take | undefined
  if (!row) return
  await tx(TAKES, 'readwrite', (s) => s.put({ ...row, notes }))
}

// ---- MIDI files ----

export async function saveMidi(slot: MidiSlot, fileName: string, data: ArrayBuffer): Promise<void> {
  const row: StoredMidi = { slot, fileName, data, savedAt: Date.now() }
  await tx(MIDI, 'readwrite', (s) => s.put(row))
}

export async function getMidi(slot: MidiSlot): Promise<StoredMidi | null> {
  const row = (await tx<StoredMidi>(MIDI, 'readonly', (s) => s.get(slot))) as StoredMidi | undefined
  return row ?? null
}

export async function deleteMidi(slot: MidiSlot): Promise<void> {
  await tx(MIDI, 'readwrite', (s) => s.delete(slot))
}

// ---- Small prefs (localStorage) ----

const PREFS_KEY = 'joe-piano-prefs-v1'

export function loadPrefs<T extends object>(defaults: T): T {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return defaults
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return defaults
  }
}

export function savePrefs(p: object): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* quota / private mode */
  }
}

export interface VideoSection {
  id: string
  name: string
  start: number
  end: number
}

const VIDEO_SECTIONS_KEY = 'joe-piano-video-sections-v1'

export function loadVideoSections(): VideoSection[] {
  try {
    const raw = localStorage.getItem(VIDEO_SECTIONS_KEY)
    const list = raw ? (JSON.parse(raw) as VideoSection[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveVideoSections(list: VideoSection[]): void {
  try {
    localStorage.setItem(VIDEO_SECTIONS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
