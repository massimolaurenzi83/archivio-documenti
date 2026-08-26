/**
 * Dashboard: cosa scade, quanti documenti per categoria, azioni rapide.
 *
 * È la prima schermata dopo lo sblocco, quindi deve rispondere in un colpo
 * d'occhio a "c'è qualcosa da fare?" prima di qualunque altra cosa.
 */
import { useMemo } from 'react'
import { CATEGORIES } from '../lib/categories'
import { buildReminders, deliverReminders } from '../lib/calendar'
import { expiryInfo } from '../lib/format'
import type { CategoryId, ArchivioDocument } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { DocumentCard } from './DocumentList'
import { EmptyState } from './ui'

export interface DashboardProps {
  documents: ArchivioDocument[]
  profileName: string
  onOpen: (doc: ArchivioDocument) => void
  onAdd: (category?: CategoryId) => void
  onGoToDocuments: (category?: CategoryId) => void
  onGoToFamily: () => void
}

export function Dashboard({
  documents,
  profileName,
  onOpen,
  onAdd,
  onGoToDocuments,
  onGoToFamily,
}: DashboardProps) {
  const { snapshot, requireAuth, toast } = useArchivio()
  const warningDays = snapshot.settings.expiryWarningDays

  const { expiring, expired, counts } = useMemo(() => {
    const map = new Map<CategoryId, number>()
    const soon: ArchivioDocument[] = []
    const past: ArchivioDocument[] = []
    for (const doc of documents) {
      map.set(doc.category, (map.get(doc.category) ?? 0) + 1)
      const info = expiryInfo(doc, warningDays)
      if (info.state === 'soon') soon.push(doc)
      else if (info.state === 'expired') past.push(doc)
    }
    const byDays = (a: ArchivioDocument, b: ArchivioDocument) =>
      expiryInfo(a, warningDays).days - expiryInfo(b, warningDays).days
    return { expiring: soon.sort(byDays), expired: past.sort(byDays), counts: map }
  }, [documents, warningDays])

  const attention = [...expired, ...expiring]

  /** Un unico file .ics per tutti i documenti con scadenza nota. */
  async function remindAll() {
    const ok = await requireAuth('Crea i promemoria di scadenza nel calendario.')
    if (!ok) return
    const result = buildReminders(documents, { anonymous: snapshot.settings.calendarAnonymous })
    if (!result) {
      toast('Nessun documento con data di scadenza.', 'error')
      return
    }
    const outcome = await deliverReminders(result)
    const quanti = `${result.count} ${result.count === 1 ? 'promemoria' : 'promemoria'}`
    if (outcome === 'downloaded') toast(`${quanti} nel file .ics: aprilo per aggiungerli al calendario.`, 'info')
    else if (outcome === 'shared') toast(`${quanti} inviati al calendario.`, 'success')
  }

  return (
    <>
      <section className="hero-stat">
        <div className="eyebrow">{profileName}</div>
        <div className="row-between" style={{ marginTop: 'var(--space-2)' }}>
          <div>
            <div className="hero-value">{documents.length}</div>
            <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
              {documents.length === 1 ? 'documento protetto' : 'documenti protetti'}
            </div>
          </div>
          <span className="lock-shield" style={{ width: 62, height: 62, borderRadius: 'var(--radius-xl)' }}>
            <Icon name="shield-check" size={28} />
          </span>
        </div>
      </section>

      <section>
        <div className="quick-actions">
          <button type="button" className="quick-action" onClick={() => onAdd()}>
            <span className="quick-action-icon">
              <Icon name="plus" size={20} />
            </span>
            Aggiungi
          </button>
          <button type="button" className="quick-action" onClick={() => onGoToDocuments()}>
            <span className="quick-action-icon">
              <Icon name="folder" size={20} />
            </span>
            Documenti
          </button>
          <button
            type="button"
            className="quick-action"
            onClick={() => onAdd('identity_card')}
          >
            <span className="quick-action-icon">
              <Icon name="scan" size={20} />
            </span>
            Scansiona
          </button>
          {snapshot.settings.familyEnabled && (
            <button type="button" className="quick-action" onClick={onGoToFamily}>
              <span className="quick-action-icon">
                <Icon name="users" size={20} />
              </span>
              Familiari
            </button>
          )}
        </div>
      </section>

      {attention.length > 0 && (
        <section>
          <div className="section-title">
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <h2 style={{ fontSize: 'var(--text-md)' }}>Da controllare</h2>
              <span className="badge badge-warning">{attention.length}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={remindAll}>
              <Icon name="calendar" size={15} />
              Nel calendario
            </button>
          </div>
          <ul className="doc-list">
            {attention.slice(0, 4).map((doc, index) => (
              <li key={doc.id}>
                <DocumentCard doc={doc} index={index} onOpen={() => onOpen(doc)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="section-title">
          <h2 style={{ fontSize: 'var(--text-md)' }}>Categorie</h2>
        </div>
        {documents.length === 0 ? (
          <EmptyState
            icon="shield"
            title="Il caveau è vuoto"
            text="Aggiungi il primo documento: verrà cifrato prima di essere salvato."
            action={
              <button type="button" className="btn btn-primary" onClick={() => onAdd()}>
                <Icon name="plus" size={18} />
                Aggiungi documento
              </button>
            }
          />
        ) : (
          <div className="cat-grid">
            {CATEGORIES.filter((c) => counts.has(c.id)).map((c) => (
              <button
                key={c.id}
                type="button"
                className="cat-tile"
                style={{ ['--cat-color' as string]: `var(--cat-${c.accent})` }}
                onClick={() => onGoToDocuments(c.id)}
              >
                <span className="cat-icon">
                  <Icon name={c.icon as never} size={19} />
                </span>
                <span className="grow">
                  <span className="cat-label">{c.short}</span>
                  <span className="cat-count">
                    {counts.get(c.id)} {counts.get(c.id) === 1 ? 'documento' : 'documenti'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--success)' }}>
            <Icon name="lock" size={18} />
          </span>
          <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-snug)' }}>
            Tutto ciò che vedi è cifrato su questo dispositivo e non esiste da nessun'altra parte.
            Ricordati di fare un backup: se perdi il telefono, nessuno potrà recuperare i documenti
            al posto tuo.
          </p>
        </div>
      </section>
    </>
  )
}
