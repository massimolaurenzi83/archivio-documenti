/**
 * Inserimento del PIN.
 *
 * Tastierino numerico grande (pollice, non mouse) con puntini di stato, più una
 * modalità testo per chi ha scelto una password alfanumerica. Il valore resta in
 * uno stato locale e non viene mai loggato.
 */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'

export interface PinPadProps {
  onSubmit: (value: string) => void
  busy?: boolean
  error?: string | null
  /** Lunghezza minima accettata prima di abilitare la conferma. */
  minLength?: number
  submitLabel?: string
  /** Consente di passare all'inserimento alfanumerico. */
  allowText?: boolean
  autoFocus?: boolean
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinPad({
  onSubmit,
  busy = false,
  error = null,
  minLength = 4,
  submitLabel = 'Sblocca',
  allowText = true,
  autoFocus = true,
}: PinPadProps) {
  const [value, setValue] = useState('')
  const [textMode, setTextMode] = useState(false)

  // Un errore azzera il campo: ritentare da un PIN parziale è solo confusione.
  useEffect(() => {
    if (error) setValue('')
  }, [error])

  // Tastiera fisica: chi usa l'app da desktop deve poter digitare.
  useEffect(() => {
    if (textMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^\d$/.test(e.key)) {
        setValue((v) => (v.length < 32 ? v + e.key : v))
      } else if (e.key === 'Backspace') {
        setValue((v) => v.slice(0, -1))
      } else if (e.key === 'Enter') {
        setValue((v) => {
          if (v.length >= minLength && !busy) onSubmit(v)
          return v
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [textMode, minLength, busy, onSubmit])

  const ready = value.length >= minLength && !busy

  if (textMode) {
    return (
      <form
        className="stack"
        style={{ width: '100%' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onSubmit(value)
        }}
      >
        <div className="field">
          <label className="label" htmlFor="pin-text">
            Password del caveau
          </label>
          <input
            id="pin-text"
            className={`input ${error ? 'input-error' : ''}`}
            type="password"
            autoComplete="current-password"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && (
          <p className="form-error">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!ready}>
          {busy ? 'Verifica…' : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTextMode(false)}>
          Usa il tastierino numerico
        </button>
      </form>
    )
  }

  return (
    <div className="stack" style={{ width: '100%' }}>
      <div className="pin-display" aria-hidden="true">
        {Array.from({ length: Math.max(minLength, value.length || minLength) }).map((_, i) => (
          <span key={i} className="pin-dot" data-filled={i < value.length} />
        ))}
      </div>

      {error && (
        <p className="form-error">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setValue((v) => (v.length < 32 ? v + key : v))}
            aria-label={`Cifra ${key}`}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          data-variant="ghost"
          onClick={() => setValue('')}
          disabled={value.length === 0}
        >
          Pulisci
        </button>
        <button type="button" onClick={() => setValue((v) => (v.length < 32 ? `${v}0` : v))}>
          0
        </button>
        <button
          type="button"
          data-variant="ghost"
          onClick={() => setValue((v) => v.slice(0, -1))}
          aria-label="Cancella ultima cifra"
          disabled={value.length === 0}
        >
          <Icon name="chevron-left" size={20} />
        </button>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={!ready}
        onClick={() => onSubmit(value)}
      >
        {busy ? 'Verifica…' : submitLabel}
      </button>

      {allowText && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTextMode(true)}>
          Ho una password alfanumerica
        </button>
      )}
    </div>
  )
}
