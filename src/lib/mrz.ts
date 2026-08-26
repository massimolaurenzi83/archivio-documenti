/**
 * Parser della banda MRZ (Machine Readable Zone) — le righe con i `<<<` che
 * compaiono sul retro della Carta d'Identità Elettronica e nella pagina dati
 * del passaporto.
 *
 * Perché conta: la MRZ ha cifre di controllo. Se il checksum torna, il dato è
 * corretto al 100% anche quando l'OCR del resto del documento sbaglia. Per
 * questo i campi provenienti dalla MRZ hanno la precedenza su tutti gli altri.
 *
 * Formati gestiti:
 *   TD1 — 3 righe da 30 caratteri (CIE italiana, permessi di soggiorno)
 *   TD2 — 2 righe da 36 caratteri (vecchie carte d'identità di alcuni Stati)
 *   TD3 — 2 righe da 44 caratteri (passaporti)
 */

export interface MrzResult {
  format: 'TD1' | 'TD2' | 'TD3'
  documentNumber?: string
  surname?: string
  givenName?: string
  nationality?: string
  /** ISO `YYYY-MM-DD`. */
  birthDate?: string
  expiryDate?: string
  sex?: 'M' | 'F'
  /** Per la CIE italiana il campo opzionale contiene il codice fiscale. */
  fiscalCode?: string
  /** Quali campi hanno superato la cifra di controllo. */
  verified: Record<string, boolean>
}

/** Pesi ciclici 7-3-1 previsti dallo standard ICAO 9303. */
const WEIGHTS = [7, 3, 1]

function charValue(c: string): number {
  if (c === '<') return 0
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55
  return 0
}

export function mrzCheckDigit(input: string): number {
  let sum = 0
  for (let i = 0; i < input.length; i++) sum += charValue(input[i]) * WEIGHTS[i % 3]
  return sum % 10
}

function verify(field: string, digit: string): boolean {
  if (!/^\d$/.test(digit)) return false
  return mrzCheckDigit(field) === Number(digit)
}

/**
 * Normalizza una riga candidata: l'OCR confonde spesso `<` con `«`, `K` o `C`
 * e inserisce spazi. Qui recuperiamo solo i caratteri legali dello standard.
 */
function normalizeLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[«‹＜]/g, '<')
    .replace(/[|!]/g, '1')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '')
}

/** Converte `YYMMDD` in ISO. `kind` decide il secolo da attribuire. */
function mrzDate(yymmdd: string, kind: 'birth' | 'expiry'): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined
  const yy = Number(yymmdd.slice(0, 2))
  const mm = yymmdd.slice(2, 4)
  const dd = yymmdd.slice(4, 6)
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return undefined
  const currentYY = new Date().getFullYear() % 100
  // Una data di nascita non può essere nel futuro; una scadenza sta nel presente/futuro.
  const century = kind === 'birth' ? (yy > currentYY ? 1900 : 2000) : yy < 70 ? 2000 : 1900
  return `${century + yy}-${mm}-${dd}`
}

/** Divide il campo nomi MRZ (`COGNOME<<NOME<SECONDONOME`). */
function parseNames(field: string): { surname?: string; givenName?: string } {
  const [rawSurname, rawGiven = ''] = field.split('<<')
  const clean = (s: string) =>
    s
      .replace(/</g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const surname = clean(rawSurname)
  const givenName = clean(rawGiven)
  return {
    surname: surname || undefined,
    givenName: givenName || undefined,
  }
}

/** Il campo opzionale della CIE contiene il codice fiscale, a volte con padding. */
function extractFiscalCode(optional: string): string | undefined {
  const candidate = optional.replace(/</g, '').trim()
  return /^[A-Z0-9]{16}$/.test(candidate) ? candidate : undefined
}

function parseTD3(l1: string, l2: string): MrzResult {
  const names = parseNames(l1.slice(5))
  const documentNumber = l2.slice(0, 9).replace(/</g, '')
  const nationality = l2.slice(10, 13).replace(/</g, '')
  const birthRaw = l2.slice(13, 19)
  const sexChar = l2[20]
  const expiryRaw = l2.slice(21, 27)

  return {
    format: 'TD3',
    ...names,
    documentNumber: documentNumber || undefined,
    nationality: nationality || undefined,
    birthDate: mrzDate(birthRaw, 'birth'),
    expiryDate: mrzDate(expiryRaw, 'expiry'),
    sex: sexChar === 'M' || sexChar === 'F' ? sexChar : undefined,
    verified: {
      documentNumber: verify(l2.slice(0, 9), l2[9]),
      birthDate: verify(birthRaw, l2[19]),
      expiryDate: verify(expiryRaw, l2[27]),
    },
  }
}

function parseTD2(l1: string, l2: string): MrzResult {
  const names = parseNames(l1.slice(5))
  const documentNumber = l2.slice(0, 9).replace(/</g, '')
  const birthRaw = l2.slice(13, 19)
  const expiryRaw = l2.slice(21, 27)
  return {
    format: 'TD2',
    ...names,
    documentNumber: documentNumber || undefined,
    nationality: l2.slice(10, 13).replace(/</g, '') || undefined,
    birthDate: mrzDate(birthRaw, 'birth'),
    expiryDate: mrzDate(expiryRaw, 'expiry'),
    sex: l2[20] === 'M' || l2[20] === 'F' ? (l2[20] as 'M' | 'F') : undefined,
    verified: {
      documentNumber: verify(l2.slice(0, 9), l2[9]),
      birthDate: verify(birthRaw, l2[19]),
      expiryDate: verify(expiryRaw, l2[27]),
    },
  }
}

function parseTD1(l1: string, l2: string, l3: string): MrzResult {
  const documentNumber = l1.slice(5, 14).replace(/</g, '')
  const optional1 = l1.slice(15, 30)
  const birthRaw = l2.slice(0, 6)
  const expiryRaw = l2.slice(8, 14)
  const optional2 = l2.slice(18, 29)
  const names = parseNames(l3)

  return {
    format: 'TD1',
    ...names,
    documentNumber: documentNumber || undefined,
    nationality: l2.slice(15, 18).replace(/</g, '') || undefined,
    birthDate: mrzDate(birthRaw, 'birth'),
    expiryDate: mrzDate(expiryRaw, 'expiry'),
    sex: l2[7] === 'M' || l2[7] === 'F' ? (l2[7] as 'M' | 'F') : undefined,
    // La CIE mette il codice fiscale nel campo opzionale: proviamo entrambi.
    fiscalCode: extractFiscalCode(optional1) ?? extractFiscalCode(optional2),
    verified: {
      documentNumber: verify(l1.slice(5, 14), l1[14]),
      birthDate: verify(birthRaw, l2[6]),
      expiryDate: verify(expiryRaw, l2[14]),
    },
  }
}

/**
 * Cerca una MRZ in un testo OCR completo e la interpreta.
 * Restituisce `null` se non ne trova una plausibile.
 */
export function parseMrz(text: string): MrzResult | null {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    // Le righe MRZ sono lunghe e ricche di `<`: scartiamo subito il resto.
    .filter((l) => l.length >= 28 && (l.match(/</g)?.length ?? 0) >= 2)

  // TD1: tre righe consecutive da ~30 caratteri.
  for (let i = 0; i + 2 < lines.length; i++) {
    const trio = [lines[i], lines[i + 1], lines[i + 2]]
    if (trio.every((l) => l.length >= 29 && l.length <= 32)) {
      const padded = trio.map((l) => l.padEnd(30, '<').slice(0, 30))
      const result = parseTD1(padded[0], padded[1], padded[2])
      if (plausible(result)) return result
    }
  }

  // TD3 e TD2: due righe consecutive.
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i]
    const b = lines[i + 1]
    if (a.length >= 42 && b.length >= 42) {
      const result = parseTD3(a.padEnd(44, '<').slice(0, 44), b.padEnd(44, '<').slice(0, 44))
      if (plausible(result)) return result
    }
    if (a.length >= 34 && a.length <= 38 && b.length >= 34 && b.length <= 38) {
      const result = parseTD2(a.padEnd(36, '<').slice(0, 36), b.padEnd(36, '<').slice(0, 36))
      if (plausible(result)) return result
    }
  }

  return null
}

/** Accettiamo il risultato solo se almeno un checksum torna e c'è una data valida. */
function plausible(r: MrzResult): boolean {
  const checks = Object.values(r.verified).filter(Boolean).length
  const hasDate = Boolean(r.birthDate || r.expiryDate)
  return checks >= 1 && hasDate
}
