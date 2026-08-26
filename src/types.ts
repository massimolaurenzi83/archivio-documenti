/** Modello dati del caveau. Nessun tipo qui viene mai serializzato in chiaro su disco. */

/**
 * Posizione di un'immagine nel documento.
 *
 * `front` e `back` valgono per i documenti a due facciate, dove la distinzione
 * è sostanziale: sulla carta d'identità il retro è dove stanno MRZ e indirizzo.
 * `page` vale per i documenti a più pagine (contratti, referti), dove conta
 * solo l'ordine: l'etichetta mostrata è la posizione nell'elenco.
 */
export type Side = 'front' | 'back' | 'page'

export type CategoryId =
  | 'identity_card'
  | 'passport'
  | 'health_card'
  | 'tax_code'
  | 'driving_license'
  | 'general'
  | 'credentials'
  | 'other'

export type FieldKey =
  | 'surname'
  | 'givenName'
  | 'fiscalCode'
  | 'documentNumber'
  | 'birthDate'
  | 'birthPlace'
  | 'issueDate'
  | 'expiryDate'
  | 'address'
  | 'nationality'
  | 'sex'
  | 'issuingAuthority'

/** Da dove arriva il valore: influenza la fiducia mostrata in UI. */
export type FieldSource = 'mrz' | 'ocr-front' | 'ocr-back' | 'manual'

export interface ExtractedField {
  key: FieldKey
  value: string
  /** 0..1 — la banda MRZ, se il checksum torna, vale 1. */
  confidence: number
  source: FieldSource
}

export interface AssetRef {
  id: string
  side: Side
  mime: string
  size: number
  width?: number
  height?: number
  /** Prima pagina di un PDF renderizzata, usata per l'anteprima e per l'OCR. */
  isPdf?: boolean
  addedAt: number
}

export interface Credential {
  username?: string
  password?: string
  url?: string
  totpNote?: string
}

export type OcrStatus = 'none' | 'running' | 'done' | 'failed' | 'unsupported'

export interface ArchivioDocument {
  id: string
  profileId: string
  category: CategoryId
  title: string
  notes?: string
  assets: AssetRef[]
  fields: ExtractedField[]
  /** Popolato solo per la categoria `credentials`. */
  credential?: Credential
  /** ISO `YYYY-MM-DD`, derivata dai campi ma modificabile: guida gli avvisi di scadenza. */
  expiryDate?: string
  ocrStatus: OcrStatus
  ocrRawText?: string
  createdAt: number
  updatedAt: number
}

export interface Profile {
  id: string
  name: string
  /** Etichetta libera: "Moglie", "Figlio", "Madre"… vuota per il profilo principale. */
  relation?: string
  /** Indice nella palette dei profili, per il colore dell'avatar. */
  colorIndex: number
  isSelf: boolean
  createdAt: number
}

/** Riferimento a un campo appuntato per l'accesso rapido dalla dashboard. */
export interface PinnedField {
  docId: string
  key: FieldKey
}

export interface Settings {
  /** Minuti di inattività prima del blocco automatico. */
  autoLockMinutes: number
  /** Sezione familiari visibile in UI. */
  familyEnabled: boolean
  /** Richiedi una nuova autenticazione prima di aprire o condividere un documento. */
  requireAuthPerDocument: boolean
  /** Giorni di preavviso per l'avviso di scadenza. */
  expiryWarningDays: number
  /** Esegui l'OCR automaticamente al caricamento. */
  ocrAutoRun: boolean
  /**
   * Nei promemoria di calendario usa solo il tipo di documento, senza il titolo
   * che l'utente gli ha dato. Serve a chi sincronizza il calendario con un
   * account condiviso.
   */
  calendarAnonymous: boolean
  /** Campi mostrati nella sezione "Dati rapidi" della dashboard. */
  pinnedFields: PinnedField[]
  /**
   * L'app ha già proposto una volta il codice fiscale come dato rapido. Serve a
   * non riproporlo a chi lo ha volutamente rimosso.
   */
  pinnedSuggested: boolean
  theme: 'dark' | 'light' | 'system'
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 3,
  familyEnabled: true,
  requireAuthPerDocument: true,
  expiryWarningDays: 60,
  ocrAutoRun: true,
  calendarAnonymous: false,
  pinnedFields: [],
  pinnedSuggested: false,
  theme: 'dark',
}

/** Metodo di sblocco configurato. Entrambi possono coesistere. */
export type UnlockMethod = 'biometric' | 'pin'
