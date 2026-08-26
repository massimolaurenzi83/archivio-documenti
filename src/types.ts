/** Modello dati del caveau. Nessun tipo qui viene mai serializzato in chiaro su disco. */

export type Side = 'front' | 'back'

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
  theme: 'dark' | 'light' | 'system'
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 3,
  familyEnabled: true,
  requireAuthPerDocument: true,
  expiryWarningDays: 60,
  ocrAutoRun: true,
  theme: 'dark',
}

/** Metodo di sblocco configurato. Entrambi possono coesistere. */
export type UnlockMethod = 'biometric' | 'pin'
