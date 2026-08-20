import { pool } from './db.js'

// Not başlığı için sabit üst sınır (yönetici limitlerinden bağımsız, kötüye kullanım koruması)
export const MAX_TITLE_LENGTH = 500

export const DEFAULT_MAX_NOTES = 2000
export const DEFAULT_MAX_NOTE_CHARS = 200000

export const LIMIT_BOUNDS = {
  maxNotes: { min: 1, max: 100000 },
  maxNoteChars: { min: 100, max: 2000000 },
} as const

export type Limits = { maxNotes: number; maxNoteChars: number }

// Kullanıcının efektif limitleri: kişisel override varsa o, yoksa genel varsayılan
export async function getLimits(uid: string): Promise<Limits> {
  const { rows } = await pool.query(
    `SELECT u.max_notes, u.max_note_chars,
       COALESCE((SELECT value::int FROM settings WHERE key = 'max_notes_per_user'), $2) AS def_notes,
       COALESCE((SELECT value::int FROM settings WHERE key = 'max_note_content_length'), $3) AS def_chars
     FROM users u WHERE u.id = $1`,
    [uid, DEFAULT_MAX_NOTES, DEFAULT_MAX_NOTE_CHARS],
  )
  if (!rows.length) return { maxNotes: DEFAULT_MAX_NOTES, maxNoteChars: DEFAULT_MAX_NOTE_CHARS }
  const r = rows[0]
  return {
    maxNotes: r.max_notes ?? r.def_notes,
    maxNoteChars: r.max_note_chars ?? r.def_chars,
  }
}

export async function getGlobalLimits(): Promise<{ maxNotesPerUser: number; maxNoteContentLength: number }> {
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('max_notes_per_user', 'max_note_content_length')`,
  )
  const map = new Map<string, number>(rows.map((r) => [r.key, Number(r.value)]))
  return {
    maxNotesPerUser: map.get('max_notes_per_user') ?? DEFAULT_MAX_NOTES,
    maxNoteContentLength: map.get('max_note_content_length') ?? DEFAULT_MAX_NOTE_CHARS,
  }
}

// Değeri [min, max] aralığında pozitif tamsayıya dönüştürür; geçersizse null
export function sanitizePositiveInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}