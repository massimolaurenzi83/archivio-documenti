/**
 * Primitive di interfaccia riutilizzabili.
 *
 * Sono volutamente "stupide": nessuna conosce il caveau, tutte prendono i dati
 * dalle props. La logica sta nelle schermate.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useBackHandler } from '../lib/backNavigation'
import { Icon, type IconName } from './Icon'
import { copyText } from '../lib/share'
import { passphraseStrength } from '../lib/crypto'
import { useArchivio } from '../state/ArchivioProvider'

/* ---------------------------------- sheet --------------------------------- */

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Nasconde la maniglia e il titolo per contenuti a tutta altezza. */
  bare?: boolean
}

/**
 * Foglio modale. Su mobile sale dal basso, su desktop compare al centro.
 *
 * Vie d'uscita, tutte necessarie: il pulsante di chiusura (l'unica visibile
 * quando il contenuto riempie lo schermo e non resta sfondo da toccare), il
 * tasto «indietro» del telefono, il tasto Esc e il tocco sullo sfondo.
 */
export function Sheet({ open, onClose, title, children, bare }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Il gesto indietro di Android chiude il foglio invece di uscire dall'app.
  useBackHandler(open, onClose)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Il focus entra nel foglio: sulle tastiere fisiche è l'unico modo di non perdersi.
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {!bare && <div className="sheet-handle" aria-hidden="true" />}
        {!bare && (
          <div className="sheet-header">
            {title ? (
              <h2 className="sheet-title" id={titleId}>
                {title}
              </h2>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn-icon sheet-close"
              onClick={onClose}
              aria-label="Chiudi"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/* --------------------------------- toast --------------------------------- */

export function Toasts() {
  const { toasts, dismissToast } = useArchivio()
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-kind={t.kind} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">
            <Icon
              name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'}
              size={17}
            />
          </span>
          <span className="grow">{t.message}</span>
        </div>
      ))}
    </div>
  )
}

/* -------------------------------- switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

/** Riga di impostazione con titolo, descrizione e controllo a destra. */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-body">
        <div className="setting-row-title">{title}</div>
        {description && <div className="setting-row-desc">{description}</div>}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------- copia dato ------------------------------- */

/**
 * Pulsante "copia" accanto a un dato. Mostra un segno di conferma per un
 * secondo: è il feedback che serve quando si sta incollando un codice fiscale
 * in un'altra applicazione.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  const { toast } = useArchivio()

  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={`Copia ${label}`}
      title={`Copia ${label}`}
      onClick={async () => {
        const ok = await copyText(value)
        if (ok) {
          setDone(true)
          window.setTimeout(() => setDone(false), 1200)
        } else {
          toast('Copia non consentita dal browser.', 'error')
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={17} />
    </button>
  )
}

/* ------------------------------- progresso ------------------------------- */

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="stack-sm">
      {label && (
        <div className="row-between">
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {label}
          </span>
          <span className="dim mono" style={{ fontSize: 'var(--text-xs)' }}>
            {pct}%
          </span>
        </div>
      )}
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 'var(--space-2)' }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </span>
  )
}

/* ------------------------------ stato vuoto ------------------------------ */

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName
  title: string
  text?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <div className="empty-title">{title}</div>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  )
}

/* -------------------------------- segmenti ------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* --------------------------- robustezza passphrase ----------------------- */

export function StrengthMeter({ value }: { value: string }) {
  const { score, label } = passphraseStrength(value)
  if (!value) return null
  return (
    <div className="stack-sm">
      <div className="strength" data-score={score} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="input-hint">Robustezza: {label}</span>
    </div>
  )
}

/* ------------------------------- conferma -------------------------------- */

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = 'Conferma',
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      <div className="sheet-body">{body}</div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annulla
        </button>
        <button
          type="button"
          className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
