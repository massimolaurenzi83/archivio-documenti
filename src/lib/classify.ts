/**
 * Riconoscimento della categoria e della faccia di un documento dal testo OCR.
 *
 * Serve al caricamento in blocco: se l'app sa già cosa ha davanti, l'utente
 * conferma invece di compilare. Il testo l'OCR l'ha comunque già letto, quindi
 * questa informazione è gratuita.
 *
 * Gerarchia dei segnali, dal più affidabile al meno:
 *
 *   1. formato della MRZ — TD3 è per definizione un passaporto, TD1 una carta
 *      d'identità o un permesso; ha cifre di controllo, quindi se il parsing
 *      riesce il formato è certo;
 *   2. titolo stampato sul documento («CARTA DI IDENTITA», «PASSAPORTO»…),
 *      cercato con tolleranza agli errori tipici dell'OCR;
 *   3. marcatori secondari (diciture, enti emittenti);
 *   4. nessun segnale: «Documenti generali», che è la risposta onesta.
 */
import { parseMrz, type MrzResult } from './mrz'
import { findFiscalCode } from './extract'
import type { CategoryId, ExtractedField, Side } from '../types'

export interface Classification {
  category: CategoryId
  /** 0..1: sotto 0,6 la UI segnala che è meglio controllare. */
  confidence: number
  /** Spiegazione mostrata all'utente: perché l'app pensa questo. */
  reason: string
}

/**
 * Normalizza il testo per il confronto: l'OCR confonde accenti e spaziature, e
 * su un titolo stampato in grande sbaglia comunque poco.
 */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
}

interface CategoryRule {
  category: CategoryId
  /** Espressioni sul testo normalizzato. */
  patterns: RegExp[]
  confidence: number
  reason: string
}

const RULES: CategoryRule[] = [
  {
    category: 'passport',
    patterns: [/\bPASSAPORTO\b/, /\bPASSPORT\b/, /\bPASSEPORT\b/],
    confidence: 0.92,
    reason: 'Trovata la dicitura «passaporto»',
  },
  {
    category: 'identity_card',
    // "IDENTITA" con o senza accento, e la forma inglese della CIE.
    patterns: [/CARTA\s+D\s?I?\s*IDENTITA/, /\bIDENTITY\s+CARD\b/, /CARTA\s+DI\s+IDENTIT/],
    confidence: 0.92,
    reason: 'Trovata la dicitura «carta di identità»',
  },
  {
    category: 'health_card',
    patterns: [
      /TESSERA\s+SANITARIA/,
      /SERVIZIO\s+SANITARIO\s+NAZIONALE/,
      /CARTA\s+NAZIONALE\s+DEI\s+SERVIZI/,
      /\bTEAM\b.*ASSICURATO/,
    ],
    confidence: 0.9,
    reason: 'Trovata la dicitura «tessera sanitaria»',
  },
  {
    category: 'driving_license',
    patterns: [/PATENTE\s+DI\s+GUIDA/, /DRIVING\s+LICEN[CS]E/, /\bPERMIS\s+DE\s+CONDUIRE\b/],
    confidence: 0.9,
    reason: 'Trovata la dicitura «patente di guida»',
  },
  {
    category: 'driving_license',
    patterns: [/MINISTERO\s+DELLE\s+INFRASTRUTTURE/, /MOTORIZZAZIONE/],
    confidence: 0.68,
    reason: 'Riconosciuto l’ente che rilascia la patente',
  },
  {
    category: 'health_card',
    patterns: [/\bMINISTERO\s+DELL\s?ECONOMIA/, /AGENZIA\s+DELLE\s+ENTRATE/],
    confidence: 0.62,
    reason: 'Riconosciuto l’ente emittente',
  },
]

/** Marcatore di codice fiscale usato come ultima risorsa. */
const TAX_ONLY = /\bCODICE\s+FISCALE\b/

export function classifyDocument(text: string, mrz?: MrzResult | null): Classification {
  const normalized = normalize(text)
  const parsedMrz = mrz ?? parseMrz(text)

  // 1. La MRZ, quando c'è, decide.
  if (parsedMrz) {
    const verified = Object.values(parsedMrz.verified).filter(Boolean).length
    if (parsedMrz.format === 'TD3') {
      return {
        category: 'passport',
        confidence: verified >= 2 ? 0.97 : 0.85,
        reason: 'Banda MRZ in formato TD3, usato dai passaporti',
      }
    }
    if (parsedMrz.format === 'TD1') {
      // TD1 è la carta d'identità elettronica italiana, ma anche i permessi di
      // soggiorno: se il testo nomina il passaporto, quello vince.
      const named = RULES.find(
        (r) => r.category === 'passport' && r.patterns.some((p) => p.test(normalized)),
      )
      if (!named) {
        return {
          category: 'identity_card',
          confidence: verified >= 2 ? 0.95 : 0.82,
          reason: 'Banda MRZ in formato TD1, usato dalla carta d’identità elettronica',
        }
      }
    }
  }

  // 2. e 3. Titoli e marcatori, in ordine di affidabilità decrescente.
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return { category: rule.category, confidence: rule.confidence, reason: rule.reason }
    }
  }

  // 4. Un tesserino che riporta solo il codice fiscale.
  if (TAX_ONLY.test(normalized) && findFiscalCode(text)) {
    return {
      category: 'tax_code',
      confidence: 0.55,
      reason: 'Trovato un codice fiscale valido e nessun altro titolo',
    }
  }

  return {
    category: 'general',
    confidence: 0.2,
    reason: 'Nessun titolo riconosciuto: scegli la categoria',
  }
}

/* ------------------------------ fronte o retro ---------------------------- */

const BACK_MARKERS = [
  /\bINDIRIZZO\b/,
  /\bRESIDENZA\b/,
  /COMUNE\s+DI\s+ISCRIZIONE/,
  /ESTREMI\s+ATTO\s+DI\s+NASCITA/,
  /\bGENITORI\b/,
  /VALIDA\s+PER\s+L\s?ESPATRIO/,
]
const FRONT_MARKERS = [/\bCOGNOME\b/, /\bSURNAME\b/, /\bNOME\b/, /\bLUOGO\s+DI\s+NASCITA\b/]

export interface SideGuess {
  side: Side
  confidence: number
}

/**
 * Distingue il fronte dal retro.
 *
 * Sulla carta d'identità elettronica la MRZ è sul retro, quindi la sua presenza
 * è il segnale più forte. Sul passaporto invece la MRZ sta nella pagina dati,
 * che è la facciata principale: per quello la regola si inverte.
 */
export function guessSide(text: string, category: CategoryId, mrz?: MrzResult | null): SideGuess {
  const normalized = normalize(text)
  const parsedMrz = mrz ?? parseMrz(text)

  if (parsedMrz) {
    if (category === 'passport') return { side: 'front', confidence: 0.9 }
    return { side: 'back', confidence: 0.9 }
  }

  const backHits = BACK_MARKERS.filter((p) => p.test(normalized)).length
  const frontHits = FRONT_MARKERS.filter((p) => p.test(normalized)).length
  if (backHits > frontHits) return { side: 'back', confidence: 0.7 }
  if (frontHits > 0) return { side: 'front', confidence: 0.7 }
  return { side: 'front', confidence: 0.3 }
}

/* --------------------------- accorpamento delle pagine -------------------- */

export interface PageLike {
  category: CategoryId
  side: Side
  fields: ExtractedField[]
}

/**
 * Valore di un campo, ma solo se affidabile.
 *
 * Il confronto tra due pagine decide se unirle: farlo su un dato incerto è
 * peggio che non farlo. Un numero di documento letto male su una delle due
 * facce dividerebbe un documento che invece è uno solo, quindi qui passano solo
 * i valori dalla MRZ (che ha cifre di controllo) o con confidenza alta.
 */
function reliableValue(page: PageLike, key: string): string | undefined {
  const field = page.fields.find((f) => f.key === key)
  if (!field) return undefined
  return field.source === 'mrz' || field.confidence >= 0.85 ? field.value : undefined
}

/**
 * Due pagine appartengono allo stesso documento?
 *
 * Richiede la stessa categoria e facce complementari; se entrambe riportano
 * cognome o codice fiscale, questi devono coincidere. È la protezione contro
 * l'errore peggiore: unire i documenti di due persone diverse fotografate una
 * dopo l'altra.
 */
export function belongTogether(first: PageLike, second: PageLike): boolean {
  if (first.category !== second.category) return false
  if (first.side === second.side) return false

  for (const key of ['fiscalCode', 'surname', 'documentNumber'] as const) {
    const a = reliableValue(first, key)
    const b = reliableValue(second, key)
    if (a && b && a.toUpperCase() !== b.toUpperCase()) return false
  }
  return true
}

/**
 * Raggruppa le pagine elaborate in documenti proposti, accorpando solo coppie
 * **consecutive**: chi fotografa fronte e retro lo fa uno dopo l'altro, e
 * cercare accoppiamenti a distanza produrrebbe abbinamenti fantasiosi.
 */
export function groupPages<T extends PageLike>(pages: T[]): T[][] {
  const groups: T[][] = []
  let index = 0
  while (index < pages.length) {
    const current = pages[index]
    const next = pages[index + 1]
    if (next && belongTogether(current, next)) {
      // Il fronte va sempre per primo, indipendentemente dall'ordine di scatto.
      groups.push(current.side === 'front' ? [current, next] : [next, current])
      index += 2
    } else {
      groups.push([current])
      index += 1
    }
  }
  return groups
}
