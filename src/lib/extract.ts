/**
 * Estrazione dei dati strutturati dal testo OCR di un documento italiano.
 *
 * Strategia, in ordine di affidabilità decrescente:
 *   1. MRZ con cifra di controllo valida (vedi `mrz.ts`) — dato certo.
 *   2. Riconoscimento del codice fiscale con validazione del carattere di controllo.
 *   3. Date associate alle parole chiave vicine (NASCITA, RILASCIO, SCADENZA).
 *   4. Numero documento per formato tipico (CIE, passaporto, patente).
 *   5. Nome e cognome dalle etichette COGNOME/SURNAME e NOME/GIVEN NAME.
 *
 * Ogni campo porta con sé la sua confidenza, così la UI può segnalare all'utente
 * cosa vale la pena ricontrollare.
 */
import { parseMrz } from './mrz'
import type { ExtractedField, FieldKey, FieldSource } from '../types'

/* ------------------------------ codice fiscale ----------------------------- */

const CF_ODD = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
]
const CF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Verifica il carattere di controllo del codice fiscale (art. 1 DM 23/12/1976). */
export function isValidFiscalCode(cf: string): boolean {
  const code = cf.toUpperCase()
  if (!/^[A-Z0-9]{16}$/.test(code)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const c = code[i]
    const value = /\d/.test(c) ? Number(c) : CF_ALPHABET.indexOf(c)
    if (value < 0) return false
    // Le posizioni si contano da 1: dispari usano la tabella, pari il valore diretto.
    sum += (i + 1) % 2 === 1 ? CF_ODD[value] : value
  }
  return CF_ALPHABET[sum % 26] === code[15]
}

/**
 * L'OCR confonde sistematicamente cifre e lettere. Il codice fiscale ha uno
 * schema fisso di posizioni alfabetiche e numeriche, quindi possiamo correggere
 * gli scambi più comuni prima di validare.
 */
const DIGIT_FIXES: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' }
const LETTER_FIXES: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A' }
/** L = lettera, N = numero, secondo il formato del codice fiscale. */
const CF_SHAPE = 'LLLLLLNNLNNLNNNL'

function coerceFiscalCode(raw: string): string {
  const chars = raw.toUpperCase().split('')
  return chars
    .map((c, i) => {
      const want = CF_SHAPE[i]
      if (want === 'N' && !/\d/.test(c)) return DIGIT_FIXES[c] ?? c
      if (want === 'L' && /\d/.test(c)) return LETTER_FIXES[c] ?? c
      return c
    })
    .join('')
}

export function findFiscalCode(text: string): string | undefined {
  const compact = text.toUpperCase().replace(/[^A-Z0-9\n ]/g, ' ')
  const candidates = compact.match(/\b[A-Z0-9]{16}\b/g) ?? []
  for (const candidate of candidates) {
    if (isValidFiscalCode(candidate)) return candidate
    const fixed = coerceFiscalCode(candidate)
    if (isValidFiscalCode(fixed)) return fixed
  }
  return undefined
}

/* ---------------------------------- date ---------------------------------- */

interface DateHit {
  iso: string
  index: number
}

const DATE_RE = /\b(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\s*[./\-\s]\s*(\d{2,4})\b/g

function toIso(d: string, m: string, y: string): string | undefined {
  let year = Number(y)
  if (y.length === 2) year += year > new Date().getFullYear() % 100 ? 1900 : 2000
  const day = Number(d)
  const month = Number(m)
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  if (year < 1900 || year > 2100) return undefined
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // Scarta date impossibili tipo 31 febbraio.
  const check = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day) return undefined
  return iso
}

function findDates(text: string): DateHit[] {
  const hits: DateHit[] = []
  for (const m of text.matchAll(DATE_RE)) {
    const iso = toIso(m[1], m[2], m[3])
    if (iso) hits.push({ iso, index: m.index ?? 0 })
  }
  return hits
}

/** Parole chiave che precedono ciascun tipo di data sui documenti italiani. */
const DATE_KEYWORDS: Record<'birthDate' | 'issueDate' | 'expiryDate', RegExp[]> = {
  birthDate: [/NAT[OA]\s+IL/i, /DATA\s+DI\s+NASCITA/i, /NASCITA/i, /DATE\s+OF\s+BIRTH/i, /BIRTH/i],
  issueDate: [/DATA\s+DI\s+RILASCIO/i, /RILASCIO/i, /EMISSIONE/i, /DATE\s+OF\s+ISSUE/i, /ISSUE/i],
  expiryDate: [
    /DATA\s+DI\s+SCADENZA/i,
    /SCADENZA/i,
    /VALIDA?\s+FINO\s+AL/i,
    /DATE\s+OF\s+EXPIRY/i,
    /EXPIRY/i,
  ],
}

/**
 * Assegna le date trovate ai tre ruoli. Prima per vicinanza a una parola chiave,
 * poi, per quel che resta, con l'euristica cronologica: la più antica è la
 * nascita, la più lontana nel futuro è la scadenza.
 */
function classifyDates(text: string): Partial<Record<'birthDate' | 'issueDate' | 'expiryDate', string>> {
  const hits = findDates(text)
  if (hits.length === 0) return {}
  const out: Partial<Record<'birthDate' | 'issueDate' | 'expiryDate', string>> = {}
  const used = new Set<number>()

  for (const [role, patterns] of Object.entries(DATE_KEYWORDS) as [
    keyof typeof DATE_KEYWORDS,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      const match = pattern.exec(text)
      if (!match) continue
      const anchor = (match.index ?? 0) + match[0].length
      // La data compare dopo l'etichetta, di solito entro un centinaio di caratteri.
      const candidate = hits
        .filter((h) => !used.has(h.index) && h.index >= anchor - 4 && h.index - anchor < 120)
        .sort((a, b) => a.index - b.index)[0]
      if (candidate) {
        out[role] = candidate.iso
        used.add(candidate.index)
        break
      }
    }
  }

  const leftovers = hits.filter((h) => !used.has(h.index)).map((h) => h.iso)
  const today = new Date().toISOString().slice(0, 10)
  if (!out.birthDate) {
    const past = leftovers.filter((d) => d < today).sort()
    if (past.length) out.birthDate = past[0]
  }
  if (!out.expiryDate) {
    const future = leftovers.filter((d) => d > today).sort()
    if (future.length) out.expiryDate = future[future.length - 1]
  }
  return out
}

/* ---------------------------- numero documento ---------------------------- */

const DOC_NUMBER_PATTERNS: RegExp[] = [
  /\b(C[A-Z]\d{5}[A-Z]{2})\b/, // CIE: CA00000AA
  /\b([A-Z]{2}\d{7})\b/, // passaporto: YA1234567
  /\b([A-Z]{2}\d{7}[A-Z])\b/, // patente: XX1234567X
  /\b(\d{9,10})\b/, // tessere varie
]

function findDocumentNumber(text: string): string | undefined {
  const upper = text.toUpperCase()
  // Se c'è un'etichetta espressa, guardiamo solo il testo che la segue.
  const labelled = /(?:NUMERO|NR\.?|N\.?°?|CARD\s*N|DOCUMENT\s*N[O°]?)\s*[:.]?\s*([A-Z0-9]{6,12})\b/.exec(
    upper,
  )
  if (labelled) return labelled[1]
  for (const pattern of DOC_NUMBER_PATTERNS) {
    const m = pattern.exec(upper)
    if (m) return m[1]
  }
  return undefined
}

/* ------------------------------ nome e cognome ---------------------------- */

/** Testo che segue un'etichetta, fino a fine riga o alla riga successiva. */
function afterLabel(lines: string[], patterns: RegExp[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      const m = pattern.exec(lines[i])
      if (!m) continue
      const inline = lines[i].slice((m.index ?? 0) + m[0].length).replace(/^[\s:./|-]+/, '')
      const value = cleanName(inline) || cleanName(lines[i + 1] ?? '')
      if (value) return value
    }
  }
  return undefined
}

function cleanName(raw: string): string | undefined {
  const value = raw
    .replace(/[^A-Za-zÀ-ÿ'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (value.length < 2 || value.length > 48) return undefined
  // Scarta righe che sono chiaramente etichette bilingui del documento.
  if (/^(SURNAME|NOME|COGNOME|GIVEN|NAME|SEX|SESSO|NATIONALITY|CITTADINANZA)$/i.test(value)) {
    return undefined
  }
  return value.toUpperCase()
}

/* --------------------------------- indirizzo ------------------------------- */

const ADDRESS_LABELS = [
  /INDIRIZZO(?:\s+DI\s+RESIDENZA)?/i,
  /RESIDENZA/i,
  /ADDRESS/i,
  /DOMICILIO/i,
]
const STREET_RE = /\b(VIA|VIALE|V\.LE|PIAZZA|P\.ZZA|CORSO|LARGO|VICOLO|STRADA|LOC\.?|LOCALITA)\b[^\n]{3,60}/i

function findAddress(text: string, lines: string[]): string | undefined {
  const labelled = afterLabelRaw(lines, ADDRESS_LABELS)
  if (labelled) return labelled
  const m = STREET_RE.exec(text)
  if (m) {
    return m[0]
      .replace(/\s+/g, ' ')
      .replace(/[|_]/g, '')
      .trim()
      .toUpperCase()
  }
  return undefined
}

/** Come `afterLabel`, ma conserva numeri civici e punteggiatura. */
function afterLabelRaw(lines: string[], patterns: RegExp[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      const m = pattern.exec(lines[i])
      if (!m) continue
      const candidates = [
        lines[i].slice((m.index ?? 0) + m[0].length),
        lines[i + 1] ?? '',
        lines[i + 2] ?? '',
      ]
      for (const candidate of candidates) {
        const value = candidate
          .replace(/^[\s:./|-]+/, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (value.length >= 5 && /[A-Za-z]{3}/.test(value)) return value.toUpperCase()
      }
    }
  }
  return undefined
}

/* ------------------------------- luogo di nascita -------------------------- */

const BIRTHPLACE_LABELS = [/LUOGO\s+DI\s+NASCITA/i, /NAT[OA]\s+A/i, /PLACE\s+OF\s+BIRTH/i, /COMUNE\s+DI\s+NASCITA/i]

/* --------------------------------- risultato ------------------------------- */

export interface ExtractionInput {
  /** Testo OCR del fronte, se disponibile. */
  front?: string
  /** Testo OCR del retro, se disponibile. */
  back?: string
}

/**
 * Unisce fronte e retro in un unico set di campi. La MRZ (tipicamente sul retro)
 * sovrascrive i valori OCR: è l'unica fonte con verifica matematica.
 */
export function extractFields(input: ExtractionInput): ExtractedField[] {
  const fields = new Map<FieldKey, ExtractedField>()

  const put = (key: FieldKey, value: string | undefined, confidence: number, source: FieldSource) => {
    if (!value) return
    const existing = fields.get(key)
    if (existing && existing.confidence >= confidence) return
    fields.set(key, { key, value, confidence, source })
  }

  for (const [side, text] of [
    ['ocr-front', input.front],
    ['ocr-back', input.back],
  ] as const) {
    if (!text) continue
    const lines = text.split(/\r?\n/).map((l) => l.trim())

    put('fiscalCode', findFiscalCode(text), 0.9, side)
    put('documentNumber', findDocumentNumber(text), 0.6, side)

    const dates = classifyDates(text)
    put('birthDate', dates.birthDate, 0.7, side)
    put('issueDate', dates.issueDate, 0.7, side)
    put('expiryDate', dates.expiryDate, 0.7, side)

    put('surname', afterLabel(lines, [/COGNOME/i, /SURNAME/i]), 0.65, side)
    put('givenName', afterLabel(lines, [/\bNOME\b/i, /GIVEN\s+NAME/i, /\bNAME\b/i]), 0.6, side)
    put('birthPlace', afterLabelRaw(lines, BIRTHPLACE_LABELS), 0.6, side)
    put('address', findAddress(text, lines), 0.55, side)
    put('issuingAuthority', afterLabelRaw(lines, [/COMUNE\s+DI(?!\s+NASCITA)/i, /AUTORITA/i, /AUTHORITY/i]), 0.5, side)
  }

  // La MRZ ha l'ultima parola.
  const mrzText = [input.back, input.front].filter(Boolean).join('\n')
  const mrz = mrzText ? parseMrz(mrzText) : null
  if (mrz) {
    const trust = (key: string) => (mrz.verified[key] ? 1 : 0.85)
    put('surname', mrz.surname, 0.95, 'mrz')
    put('givenName', mrz.givenName, 0.95, 'mrz')
    put('documentNumber', mrz.documentNumber, trust('documentNumber'), 'mrz')
    put('birthDate', mrz.birthDate, trust('birthDate'), 'mrz')
    put('expiryDate', mrz.expiryDate, trust('expiryDate'), 'mrz')
    put('nationality', mrz.nationality, 0.95, 'mrz')
    put('sex', mrz.sex, 0.95, 'mrz')
    if (mrz.fiscalCode && isValidFiscalCode(mrz.fiscalCode)) {
      put('fiscalCode', mrz.fiscalCode, 1, 'mrz')
    }
  }

  return [...fields.values()].sort(
    (a, b) => FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key),
  )
}

/** Ordine di presentazione in UI: prima l'identità, poi le date, poi il resto. */
export const FIELD_ORDER: FieldKey[] = [
  'surname',
  'givenName',
  'fiscalCode',
  'documentNumber',
  'birthDate',
  'birthPlace',
  'sex',
  'nationality',
  'issueDate',
  'expiryDate',
  'address',
  'issuingAuthority',
]

export const FIELD_LABELS: Record<FieldKey, string> = {
  surname: 'Cognome',
  givenName: 'Nome',
  fiscalCode: 'Codice fiscale',
  documentNumber: 'Numero documento',
  birthDate: 'Data di nascita',
  birthPlace: 'Luogo di nascita',
  issueDate: 'Data di rilascio',
  expiryDate: 'Data di scadenza',
  address: 'Indirizzo / residenza',
  nationality: 'Cittadinanza',
  sex: 'Sesso',
  issuingAuthority: 'Rilasciato da',
}

/** I campi data usano un input `date` nel form di correzione. */
export const DATE_FIELDS = new Set<FieldKey>(['birthDate', 'issueDate', 'expiryDate'])
