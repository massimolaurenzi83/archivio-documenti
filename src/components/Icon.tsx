/**
 * Set di icone inline, disegnato a mano.
 *
 * Regole del set — vanno rispettate da qualunque icona nuova, altrimenti
 * l'insieme perde coerenza e si vede subito:
 *
 *  - griglia 24 × 24, contenuto entro il riquadro 3…21 (margine ottico di 3px);
 *  - un solo spessore di tratto (`strokeWidth`, default 1.7), mai due nella
 *    stessa icona;
 *  - terminali e giunzioni arrotondati, sempre;
 *  - i punti sono cerchi pieni, non tratti accorciati;
 *  - raggi di curvatura coerenti: 2,2–2,6 per i contenitori, 1,2 per i dettagli;
 *  - nessuna forma sotto i 2px: a 20px di resa sparirebbe.
 *
 * Ogni glifo è JSX (non una stringa `d`) così può combinare `path`, `circle` e
 * `rect`: è la differenza tra un'icona disegnata e una approssimata.
 */
import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'shield'
  | 'shield-check'
  | 'lock'
  | 'unlock'
  | 'fingerprint'
  | 'keypad'
  | 'id-card'
  | 'passport'
  | 'health'
  | 'tax'
  | 'car'
  | 'file'
  | 'key'
  | 'sparkle'
  | 'plus'
  | 'camera'
  | 'image'
  | 'copy'
  | 'check'
  | 'share'
  | 'trash'
  | 'edit'
  | 'close'
  | 'chevron-right'
  | 'chevron-left'
  | 'home'
  | 'folder'
  | 'users'
  | 'settings'
  | 'download'
  | 'upload'
  | 'alert'
  | 'eye'
  | 'eye-off'
  | 'search'
  | 'refresh'
  | 'info'
  | 'clock'
  | 'flip'
  | 'scan'

/** Punto pieno: usato per keyhole, tasti, pallini di avviso. */
function Dot({ cx, cy, r = 1.05 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
}

const GLYPHS: Record<IconName, ReactNode> = {
  /* ------------------------------ sicurezza ------------------------------ */

  // Scudo pieno: la sagoma è la stessa di `shield-check`, così i due glifi
  // sembrano lo stesso oggetto in due stati.
  shield: (
    <path
      d="M12 3.1 5.2 5.6v5.9c0 4.4 2.7 7.9 6.8 9.4 4.1-1.5 6.8-5 6.8-9.4V5.6L12 3.1Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  'shield-check': (
    <>
      <path d="M12 3.1 5.2 5.6v5.9c0 4.4 2.7 7.9 6.8 9.4 4.1-1.5 6.8-5 6.8-9.4V5.6L12 3.1Z" />
      <path d="m8.9 11.9 2.2 2.2 4.2-4.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.4" width="14" height="9.8" rx="2.4" />
      <path d="M8.6 10.4V7.8a3.4 3.4 0 0 1 6.8 0v2.6" />
      <Dot cx={12} cy={15.3} r={1.2} />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.4" width="14" height="9.8" rx="2.4" />
      <path d="M8.6 10.4V7.8a3.4 3.4 0 0 1 6.4-1.6" />
      <Dot cx={12} cy={15.3} r={1.2} />
    </>
  ),
  // Creste concentriche: tre archi e due linee interne. È l'icona più esposta
  // dell'app (sblocco), quindi vale il dettaglio in più.
  fingerprint: (
    <>
      <path d="M4.1 8.9a9.7 9.7 0 0 1 15.8 0" />
      <path d="M6.7 12.2a5.8 5.8 0 0 1 10.6 0c0 3-.6 5.7-1.8 8" />
      <path d="M12 8.2a4 4 0 0 0-4 4v2.6c0 1.7-.4 3.4-1.1 4.9" />
      <path d="M12 12.1v3.4c0 1.7-.3 3.3-.9 4.8" />
    </>
  ),
  keypad: (
    <>
      <Dot cx={7.6} cy={7.4} />
      <Dot cx={12} cy={7.4} />
      <Dot cx={16.4} cy={7.4} />
      <Dot cx={7.6} cy={12} />
      <Dot cx={12} cy={12} />
      <Dot cx={16.4} cy={12} />
      <Dot cx={7.6} cy={16.6} />
      <Dot cx={12} cy={16.6} />
      <Dot cx={16.4} cy={16.6} />
    </>
  ),

  /* ------------------------------ categorie ------------------------------ */

  // Tessera: foto a sinistra, due righe dati a destra. Le proporzioni sono
  // quelle reali di una ID-1 (1,586).
  'id-card': (
    <>
      <rect x="3" y="5.6" width="18" height="12.8" rx="2.4" />
      <circle cx="8.5" cy="11.2" r="1.9" />
      <path d="M5.8 16.1c.5-1.4 1.4-2.1 2.7-2.1s2.2.7 2.7 2.1" />
      <path d="M14.2 10.2h4.2M14.2 13.4h3" />
    </>
  ),
  // Passaporto: copertina con lo stemma circolare e la riga del titolo.
  passport: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.4" />
      <circle cx="12" cy="10.2" r="2.7" />
      <path d="M12 7.5v5.4M9.3 10.2h5.4" />
      <path d="M9.6 16.9h4.8" />
    </>
  ),
  // Tessera sanitaria: croce medica più le righe dati.
  health: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.4" />
      <path d="M8.4 10.2v3.6M6.6 12h3.6" />
      <path d="M14 10.7h4.2M14 13.6h2.8" />
    </>
  ),
  // Codice fiscale: la tessera col codice a barre, che è come la si riconosce.
  tax: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.4" />
      <path d="M6.6 9.4v5.2M8.9 9.4v5.2M11.2 9.4v5.2M14.6 9.4v5.2M17.4 9.4v5.2" />
    </>
  ),
  car: (
    <>
      <path d="M4.4 16.2h15.2" />
      <path d="m6.4 16.2 1.5-4.7a2.2 2.2 0 0 1 2.1-1.5h4a2.2 2.2 0 0 1 2.1 1.5l1.5 4.7" />
      <circle cx="8.4" cy="18.2" r="1.5" />
      <circle cx="15.6" cy="18.2" r="1.5" />
    </>
  ),
  file: (
    <>
      <path d="M7.2 3.4h6.2l4.4 4.4v12.8H7.2Z" />
      <path d="M13.2 3.4v4.4h4.4" />
      <path d="M9.8 12.4h4.6M9.8 15.6h3.4" />
    </>
  ),
  key: (
    <>
      <circle cx="7.4" cy="12" r="3.4" />
      <path d="M10.8 12h8.8" />
      <path d="M16.6 12v3.1M19.2 12v2.2" />
    </>
  ),
  // Stella a quattro punte con concavità: la versione a spigoli diritti è la
  // firma inconfondibile di un'icona generata di fretta.
  sparkle: (
    <>
      <path d="M12 3.8c.6 3 1.6 4.6 4.6 5.6-3 1-4 2.6-4.6 5.6-.6-3-1.6-4.6-4.6-5.6 3-1 4-2.6 4.6-5.6Z" />
      <path d="M17.6 15.4c.3 1.5.8 2.2 2.3 2.6-1.5.4-2 1.1-2.3 2.6-.3-1.5-.8-2.2-2.3-2.6 1.5-.4 2-1.1 2.3-2.6Z" />
    </>
  ),

  /* -------------------------------- azioni ------------------------------- */

  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  camera: (
    <>
      <rect x="3" y="7.6" width="18" height="12.4" rx="2.6" />
      <path d="m8.8 7.6 1.1-2.3h4.2l1.1 2.3" />
      <circle cx="12" cy="13.8" r="3.2" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.4" />
      <Dot cx={8.7} cy={9.9} r={1.5} />
      <path d="m4.4 17.6 5.2-4.9 2.9 2.8 3.2-3.2 4.9 4.9" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="10.6" height="10.6" rx="2.2" />
      <path d="M15 9V6.6A2.2 2.2 0 0 0 12.8 4.4H6.6A2.2 2.2 0 0 0 4.4 6.6v6.2A2.2 2.2 0 0 0 6.6 15H9" />
    </>
  ),
  check: <path d="m5.4 12.6 4.4 4.4 9-9.6" />,
  share: (
    <>
      <path d="M12 3.8v10.8" />
      <path d="m8.2 7.4 3.8-3.8 3.8 3.8" />
      <path d="M5.4 13.2v5.6a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6v-5.6" />
    </>
  ),
  trash: (
    <>
      <path d="M5.4 7.4h13.2" />
      <path d="M9.6 7.4V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v2" />
      <path d="m7.3 7.4.8 12.1a1.4 1.4 0 0 0 1.4 1.3h5a1.4 1.4 0 0 0 1.4-1.3l.8-12.1" />
      <path d="M10.6 11.2v5.6M13.4 11.2v5.6" />
    </>
  ),
  edit: (
    <>
      <path d="M4.4 19.6h4l10.9-10.9a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.4 15.6Z" />
      <path d="m14.1 5.6 4.3 4.3" />
    </>
  ),
  close: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />,
  'chevron-right': <path d="m9.8 5.6 6.2 6.4-6.2 6.4" />,
  'chevron-left': <path d="M14.2 5.6 8 12l6.2 6.4" />,

  /* ------------------------------ navigazione ---------------------------- */

  home: (
    <path d="M4.2 11.1 12 4.4l7.8 6.7v7.5a1.6 1.6 0 0 1-1.6 1.6h-3.6v-5.6H9.4v5.6H5.8a1.6 1.6 0 0 1-1.6-1.6Z" />
  ),
  folder: (
    <path d="M4 7.4a1.6 1.6 0 0 1 1.6-1.6h3.2l2 2.6h7.6A1.6 1.6 0 0 1 20 10v7.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.8Z" />
  ),
  users: (
    <>
      <circle cx="9.2" cy="9" r="3.2" />
      <path d="M3.7 19.3c.6-3 2.6-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M15.4 6.3a3.2 3.2 0 0 1 0 5.4" />
      <path d="M17.1 14.9c1.9.7 3 2.2 3.4 4.4" />
    </>
  ),
  // Cursori invece dell'ingranaggio: a 21px un ingranaggio diventa una macchia,
  // due slider restano leggibili.
  settings: (
    <>
      <path d="M4.4 8.2h8.2M17.4 8.2h2.2" />
      <path d="M4.4 15.8h2.2M11.4 15.8h8.2" />
      <circle cx="15" cy="8.2" r="2.3" />
      <circle cx="9" cy="15.8" r="2.3" />
    </>
  ),

  /* ------------------------------ trasferimenti -------------------------- */

  download: (
    <>
      <path d="M12 4.4v10.2" />
      <path d="m8.2 10.8 3.8 3.8 3.8-3.8" />
      <path d="M4.8 19.6h14.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4.8" />
      <path d="m8.2 8.6 3.8-3.8 3.8 3.8" />
      <path d="M4.8 19.6h14.4" />
    </>
  ),

  /* --------------------------------- stato ------------------------------- */

  alert: (
    <>
      <path d="M10.4 4.9a1.8 1.8 0 0 1 3.2 0l6.4 12.6a1.8 1.8 0 0 1-1.6 2.6H5.6A1.8 1.8 0 0 1 4 17.5Z" />
      <path d="M12 9.6v4.2" />
      <Dot cx={12} cy={16.6} r={0.95} />
    </>
  ),
  eye: (
    <>
      <path d="M2.9 12S6.4 6.2 12 6.2 21.1 12 21.1 12 17.6 17.8 12 17.8 2.9 12 2.9 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  'eye-off': (
    <>
      <path d="m4.2 4.2 15.6 15.6" />
      <path d="M9.9 10a2.9 2.9 0 0 0 4.1 4.1" />
      <path d="M6.6 7C4.2 8.7 2.9 12 2.9 12s3.5 5.8 9.1 5.8c1.5 0 2.9-.4 4.1-1" />
      <path d="M18.1 15.2c1.9-1.7 3-3.2 3-3.2S17.6 6.2 12 6.2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="5.8" />
      <path d="m14.9 14.9 4.7 4.7" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.9 12a7.9 7.9 0 1 1-2.6-5.9" />
      <path d="M19.9 4.7v5.5h-5.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11.4v5" />
      <Dot cx={12} cy={8.3} r={0.95} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2.1" />
    </>
  ),

  /* ------------------------------ acquisizione --------------------------- */

  // Fronte/retro: la freccia che gira intorno all'asse verticale.
  flip: (
    <>
      <path d="M12 3.8v16.4" />
      <path d="M8.4 8.2 4.8 12l3.6 3.8" />
      <path d="m15.6 8.2 3.6 3.8-3.6 3.8" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8.8V6a2 2 0 0 1 2-2h2.8" />
      <path d="M20 8.8V6a2 2 0 0 0-2-2h-2.8" />
      <path d="M4 15.2V18a2 2 0 0 0 2 2h2.8" />
      <path d="M20 15.2V18a2 2 0 0 1-2 2h-2.8" />
      <path d="M4.8 12h14.4" />
    </>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  strokeWidth?: number
}

export function Icon({ name, size = 20, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  )
}
