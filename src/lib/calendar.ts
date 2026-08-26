/**
 * Promemoria di scadenza in formato iCalendar (RFC 5545).
 *
 * Perché passare dal calendario invece di notificare direttamente: una notifica
 * programmata non esiste nel web senza un server. `Notification` scatta solo a
 * pagina aperta e il Periodic Background Sync è solo su Chrome-Android e non
 * garantisce alcuna consegna. Il calendario del telefono, invece, notifica in
 * modo affidabile, funziona offline ed è già installato su ogni dispositivo.
 *
 * Il file esce dal caveau, quindi contiene il minimo indispensabile: titolo del
 * documento (o solo la categoria, se si sceglie il promemoria anonimo) e data.
 * Mai numeri di documento, codici fiscali o altri campi estratti.
 *
 * Attenzione ai dettagli del formato: i calendari reali sono severi. Righe
 * terminate CRLF, piegatura a 75 ottetti, caratteri riservati con escape, UID
 * stabile perché una seconda esportazione aggiorni l'evento invece di
 * duplicarlo.
 */
import { category } from './categories'
import { canShareFiles, downloadBlob, shareFiles } from './share'
import type { ArchivioDocument } from '../types'

/** Giorni di preavviso: uno comodo per rinnovare, uno di ultima chiamata. */
const ALARM_DAYS = [60, 7] as const

export interface ReminderOptions {
  /** Usa solo la categoria come titolo, senza il nome dato al documento. */
  anonymous?: boolean
  /** Nome del profilo, aggiunto solo se non anonimo e se non è il principale. */
  ownerName?: string
}

/* ------------------------------- primitive ------------------------------- */

/** Escape dei caratteri riservati: virgola, punto e virgola, backslash, newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Piegatura delle righe lunghe. Il limite dell'RFC è di 75 **ottetti**, non
 * caratteri: con le accentate italiane, contare i caratteri produrrebbe righe
 * troppo lunghe che alcuni calendari rifiutano.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let currentBytes = 0
  // Prima riga 75 ottetti, le successive 74 (uno se lo prende lo spazio iniziale).
  let limit = 75

  for (const char of line) {
    const size = encoder.encode(char).length
    if (currentBytes + size > limit) {
      out.push(current)
      current = ''
      currentBytes = 0
      limit = 74
    }
    current += char
    currentBytes += size
  }
  if (current) out.push(current)
  return out.join('\r\n ')
}

/** `YYYY-MM-DD` -> `YYYYMMDD`, il formato DATE dell'RFC. */
function toIcsDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${match[1]}${match[2]}${match[3]}` : null
}

/** Giorno successivo: per un evento di un giorno intero DTEND è esclusivo. */
function nextDay(iso: string): string | null {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + 1)
  return toIcsDate(date.toISOString().slice(0, 10))
}

function timestamp(): string {
  return `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/* --------------------------------- eventi -------------------------------- */

/** Data di scadenza del documento, se conosciuta. */
export function expiryOf(doc: ArchivioDocument): string | undefined {
  return doc.expiryDate ?? doc.fields.find((f) => f.key === 'expiryDate')?.value
}

function buildEvent(doc: ArchivioDocument, options: ReminderOptions): string[] | null {
  const iso = expiryOf(doc)
  if (!iso) return null
  const start = toIcsDate(iso)
  const end = nextDay(iso)
  if (!start || !end) return null

  const categoryLabel = category(doc.category).label
  const title = options.anonymous
    ? `Scadenza ${categoryLabel}`
    : `Scadenza ${doc.title}${options.ownerName ? ` (${options.ownerName})` : ''}`

  const lines = [
    'BEGIN:VEVENT',
    // UID stabile: riesportare aggiorna l'evento, non ne crea un altro.
    `UID:${doc.id}@archivio-documenti`,
    `DTSTAMP:${timestamp()}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(
      'Promemoria creato da Archivio Documenti. Apri l’app per consultare il documento: i dati restano cifrati sul tuo dispositivo.',
    )}`,
    `CATEGORIES:${escapeText(categoryLabel)}`,
    'TRANSP:TRANSPARENT',
    'SEQUENCE:0',
  ]

  for (const days of ALARM_DAYS) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-P${days}D`,
      `DESCRIPTION:${escapeText(`${title} — tra ${days} giorni`)}`,
      'END:VALARM',
    )
  }

  lines.push('END:VEVENT')
  return lines
}

/* ---------------------------------- API ---------------------------------- */

export interface CalendarResult {
  blob: Blob
  filename: string
  /** Quanti documenti hanno prodotto un promemoria. */
  count: number
  /** Documenti saltati perché senza data di scadenza. */
  skipped: number
}

/**
 * Costruisce il file iCalendar per uno o più documenti.
 * Restituisce `null` se nessun documento ha una data di scadenza utilizzabile.
 */
export function buildReminders(
  documents: ArchivioDocument[],
  options: ReminderOptions & { ownerNameFor?: (doc: ArchivioDocument) => string | undefined } = {},
): CalendarResult | null {
  const events: string[] = []
  let skipped = 0

  for (const doc of documents) {
    const event = buildEvent(doc, {
      anonymous: options.anonymous,
      ownerName: options.ownerNameFor?.(doc) ?? options.ownerName,
    })
    if (event) events.push(...event)
    else skipped++
  }
  if (events.length === 0) return null

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Archivio Documenti//Promemoria scadenze//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ]

  // CRLF obbligatorio, e riga finale terminata: alcuni parser scartano l'ultima
  // riga se il file non finisce con l'interruzione.
  const text = `${calendar.map(foldLine).join('\r\n')}\r\n`
  const count = events.filter((l) => l === 'BEGIN:VEVENT').length

  return {
    blob: new Blob([text], { type: 'text/calendar;charset=utf-8' }),
    filename: count === 1 ? 'scadenza-documento.ics' : 'scadenze-archivio.ics',
    count,
    skipped,
  }
}

/**
 * Consegna il file al calendario del dispositivo: sul telefono il foglio di
 * condivisione offre direttamente "Aggiungi al calendario"; altrove si ripiega
 * sul salvataggio, e il doppio clic sul file lo apre nel calendario.
 */
export async function deliverReminders(
  result: CalendarResult,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([result.blob], result.filename, { type: 'text/calendar' })
  if (canShareFiles([file])) {
    const outcome = await shareFiles([file], { title: 'Promemoria scadenze' })
    if (outcome === 'shared') return 'shared'
    if (outcome === 'cancelled') return 'cancelled'
  }
  downloadBlob(result.blob, result.filename)
  return 'downloaded'
}
