/**
 * Catalogo delle categorie di documento.
 *
 * Ogni categoria dichiara come va trattata: se ha un retro, se conviene cercare
 * la MRZ, quali campi ha senso mostrare. Aggiungere una categoria significa
 * aggiungere una voce qui, senza toccare la UI.
 */
import type { CategoryId, FieldKey } from '../types'

export interface CategoryDef {
  id: CategoryId
  label: string
  /** Etichetta breve per i filtri. */
  short: string
  /** Nome del token colore in `tokens.css` (`--cat-<accent>`). */
  accent: string
  /** Glifo SVG dell'icona, definito in `components/Icon.tsx`. */
  icon: string
  /** Il retro contiene informazioni utili: la UI lo propone attivamente. */
  hasBack: boolean
  /** Cerca la banda MRZ (di norma sul retro, sul passaporto nella pagina dati). */
  mrz: boolean
  /** Documento con scadenza: attiva gli avvisi. */
  expires: boolean
  /** Nessuna immagine richiesta: è una voce di credenziali. */
  secretsOnly?: boolean
  /** Campi da evidenziare in cima alla scheda. */
  highlight: FieldKey[]
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'identity_card',
    label: "Carta d'Identità",
    short: 'Identità',
    accent: 'blue',
    icon: 'id-card',
    hasBack: true,
    mrz: true,
    expires: true,
    highlight: ['documentNumber', 'fiscalCode', 'expiryDate'],
  },
  {
    id: 'passport',
    label: 'Passaporto',
    short: 'Passaporto',
    accent: 'indigo',
    icon: 'passport',
    hasBack: true,
    mrz: true,
    expires: true,
    highlight: ['documentNumber', 'expiryDate', 'nationality'],
  },
  {
    id: 'health_card',
    label: 'Tessera Sanitaria',
    short: 'Sanitaria',
    accent: 'teal',
    icon: 'health',
    hasBack: true,
    mrz: false,
    expires: true,
    highlight: ['fiscalCode', 'expiryDate'],
  },
  {
    id: 'tax_code',
    label: 'Codice Fiscale',
    short: 'Cod. fiscale',
    accent: 'green',
    icon: 'tax',
    hasBack: true,
    mrz: false,
    expires: false,
    highlight: ['fiscalCode'],
  },
  {
    id: 'driving_license',
    label: 'Patente di guida',
    short: 'Patente',
    accent: 'amber',
    icon: 'car',
    hasBack: true,
    mrz: false,
    expires: true,
    highlight: ['documentNumber', 'expiryDate'],
  },
  {
    id: 'general',
    label: 'Documenti generali',
    short: 'Generali',
    accent: 'slate',
    icon: 'file',
    hasBack: true,
    mrz: false,
    expires: false,
    highlight: [],
  },
  {
    id: 'credentials',
    label: 'Password e credenziali',
    short: 'Password',
    accent: 'rose',
    icon: 'key',
    hasBack: false,
    mrz: false,
    expires: false,
    secretsOnly: true,
    highlight: [],
  },
  {
    id: 'other',
    label: 'Altro',
    short: 'Altro',
    accent: 'violet',
    icon: 'sparkle',
    hasBack: true,
    mrz: false,
    expires: true,
    highlight: [],
  },
]

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))

export function category(id: CategoryId): CategoryDef {
  return BY_ID.get(id) ?? CATEGORIES[CATEGORIES.length - 1]
}
