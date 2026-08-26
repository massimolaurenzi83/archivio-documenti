/** Formattazione e piccole utilità condivise dalla UI. */
import type { ArchivioDocument } from '../types'

const DATE_FMT = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
const SHORT_FMT = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function formatIsoDate(iso: string | undefined, style: 'long' | 'short' = 'long'): string {
  if (!iso) return '—'
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return (style === 'long' ? DATE_FMT : SHORT_FMT).format(date)
}

export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired'

export interface ExpiryInfo {
  state: ExpiryState
  /** Giorni rimanenti; negativo se già scaduto. */
  days: number
  label: string
}

/** Stato di scadenza di un documento, con etichetta pronta per la UI. */
export function expiryInfo(doc: ArchivioDocument, warningDays: number): ExpiryInfo {
  const iso = doc.expiryDate ?? doc.fields.find((f) => f.key === 'expiryDate')?.value
  if (!iso) return { state: 'none', days: Number.POSITIVE_INFINITY, label: 'Senza scadenza' }

  const target = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(target.getTime())) {
    return { state: 'none', days: Number.POSITIVE_INFINITY, label: 'Senza scadenza' }
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  if (days < 0) {
    return { state: 'expired', days, label: `Scaduto da ${pluralDays(-days)}` }
  }
  if (days === 0) return { state: 'soon', days, label: 'Scade oggi' }
  if (days <= warningDays) return { state: 'soon', days, label: `Scade tra ${pluralDays(days)}` }
  return { state: 'ok', days, label: `Valido fino al ${formatIsoDate(iso, 'short')}` }
}

function pluralDays(n: number): string {
  if (n === 1) return '1 giorno'
  if (n < 45) return `${n} giorni`
  const months = Math.round(n / 30)
  if (months < 24) return `${months} mesi`
  return `${Math.round(n / 365)} anni`
}

/** Iniziali per l'avatar del profilo. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Titolo suggerito quando l'utente non ne indica uno. */
export function suggestedTitle(categoryLabel: string, ownerName?: string): string {
  return ownerName ? `${categoryLabel} · ${ownerName}` : categoryLabel
}

/** Raggruppa i valori per chiave, mantenendo l'ordine di inserimento. */
export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

/**
 * Maschera un valore lasciando visibile quanto basta a riconoscerlo senza
 * rivelarlo: `RSSMRA85T10A562S` diventa `RSS•••••••••62S`.
 *
 * Serve nella sezione dei dati rapidi, dove il valore sta in una schermata che
 * si apre subito dopo lo sblocco: chi sbircia lo schermo non deve poterlo
 * leggere, ma l'utente deve capire quale dato è.
 */
export function maskValue(value: string): string {
  const clean = value.trim()
  if (clean.length <= 4) return '•'.repeat(Math.max(clean.length, 3))
  const head = clean.length >= 10 ? 3 : 1
  const tail = clean.length >= 10 ? 3 : 1
  return clean.slice(0, head) + '•'.repeat(clean.length - head - tail) + clean.slice(-tail)
}
