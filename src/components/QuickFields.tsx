/**
 * "Dati rapidi": i campi appuntati, con la copia a un tocco.
 *
 * Risolve il motivo per cui l'app esiste — incollare il codice fiscale in un
 * messaggio senza ricopiarlo — che prima richiedeva sei passaggi.
 *
 * Il compromesso di sicurezza è esplicito: i valori restano mascherati finché
 * non arriva una riconferma d'identità. Dopo, per la stessa finestra di venti
 * secondi già usata dal resto dell'app, restano leggibili e la copia è
 * immediata. Nessuna scorciatoia salta l'autenticazione.
 */
import { useEffect, useRef, useState } from 'react'
import { FIELD_LABELS, DATE_FIELDS } from '../lib/extract'
import { formatIsoDate, maskValue } from '../lib/format'
import { copyText } from '../lib/share'
import { archivio } from '../lib/archivio'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'

/** Durata della finestra di leggibilità: la stessa della riconferma. */
const REVEAL_SECONDS = 20

export function QuickFields() {
  const { snapshot, requireAuth, toast } = useArchivio()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const hideTimer = useRef<number | null>(null)

  // I valori arrivano dal servizio, che scarta i pin verso documenti eliminati.
  const entries = archivio.pinnedEntries()

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  // Il caveau che si richiude deve spegnere anche questa finestra.
  useEffect(() => {
    if (snapshot.status !== 'unlocked') setRevealed(false)
  }, [snapshot.status])

  function startRevealWindow() {
    setRevealed(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setRevealed(false), REVEAL_SECONDS * 1000)
  }

  async function reveal() {
    if (revealed) {
      setRevealed(false)
      return
    }
    const ok = await requireAuth('Mostra i dati rapidi in chiaro.')
    if (ok) startRevealWindow()
  }

  async function copy(key: string, value: string, label: string) {
    // La riconferma resta anche solo per copiare: il dato esce dal caveau.
    const ok = await requireAuth(`Copia ${label}.`)
    if (!ok) return
    const done = await copyText(value)
    if (!done) {
      toast('Copia non consentita dal browser.', 'error')
      return
    }
    // Dopo un'autenticazione riuscita vale la stessa finestra di leggibilità.
    startRevealWindow()
    setCopied(key)
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400)
    toast(`${label} copiato.`, 'success')
  }

  if (entries.length === 0) return null

  return (
    <section>
      <div className="section-title">
        <h2 style={{ fontSize: 'var(--text-md)' }}>Dati rapidi</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reveal}>
          <Icon name={revealed ? 'eye-off' : 'eye'} size={15} />
          {revealed ? 'Nascondi' : 'Mostra'}
        </button>
      </div>

      <div className="list-group">
        {entries.map((entry) => {
          const id = `${entry.docId}:${entry.key}`
          const label = FIELD_LABELS[entry.key]
          const display = revealed
            ? DATE_FIELDS.has(entry.key)
              ? formatIsoDate(entry.value)
              : entry.value
            : maskValue(entry.value)

          return (
            <div className="field-row" key={id}>
              <div className="field-row-body">
                <div className="field-row-label">
                  {label}
                  <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>
                    · {entry.title}
                  </span>
                </div>
                <div className="field-row-value" data-masked={!revealed}>
                  {display}
                </div>
              </div>
              <div className="field-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Copia ${label}`}
                  onClick={() => copy(id, entry.value, label)}
                >
                  <Icon name={copied === id ? 'check' : 'copy'} size={17} />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Togli ${label} dai dati rapidi`}
                  onClick={async () => {
                    await archivio.togglePinnedField(entry.docId, entry.key)
                    toast('Rimosso dai dati rapidi.', 'info')
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
