/**
 * Scheda del documento: anteprima fronte/retro, dati estratti, condivisione.
 *
 * Regola di sicurezza applicata qui: le immagini restano sfocate e i segreti
 * mascherati finché non arriva la riconferma d'identità, e la condivisione ne
 * chiede una nuova. Il contenuto in chiaro non compare mai per inerzia.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { category } from '../lib/categories'
import { DATE_FIELDS, FIELD_LABELS, FIELD_ORDER } from '../lib/extract'
import { buildReminders, deliverReminders } from '../lib/calendar'
import { expiryInfo, formatIsoDate, formatTimestamp, pageLabel } from '../lib/format'
import { canvasToBlob, renderPdfPage } from '../lib/pdf'
import {
  extensionForMime,
  safeFilename,
  shareFiles,
  shareText,
  copyText,
} from '../lib/share'
import { archivio } from '../lib/archivio'
import type { ExtractedField, FieldKey, ArchivioDocument } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { ConfirmSheet, CopyButton, EmptyState, Sheet, Spinner } from './ui'

export interface DocumentDetailProps {
  doc: ArchivioDocument
  onClose: () => void
  ownerName?: string
}

export function DocumentDetail({ doc, onClose, ownerName }: DocumentDetailProps) {
  const { snapshot, requireAuth, toast } = useArchivio()
  const def = category(doc.category)
  /** Indice della pagina mostrata: funziona sia per fronte/retro sia per i multipagina. */
  const [pageIndex, setPageIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [addingField, setAddingField] = useState(false)

  const expiry = expiryInfo(doc, snapshot.settings.expiryWarningDays)
  const assets = doc.assets
  const current = assets[pageIndex] ?? assets[0]

  /* --------------------------- caricamento immagini ------------------------ */

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      // Chiave per id, non per faccia: le pagine di un multipagina hanno tutte
      // `side: 'page'` e si sovrascriverebbero a vicenda.
      const next: Record<string, string> = {}
      for (const ref of assets) {
        const blob = await archivio.loadAsset(ref)
        // Un PDF non si mostra in un <img>: ne renderizziamo la prima pagina.
        if (ref.mime === 'application/pdf') {
          const { canvas } = await renderPdfPage(blob, 1, 1200)
          const png = await canvasToBlob(canvas, 'image/png')
          next[ref.id] = URL.createObjectURL(png)
        } else {
          next[ref.id] = URL.createObjectURL(blob)
        }
      }
      setUrls(next)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Apertura non riuscita.', 'error')
    } finally {
      setLoading(false)
    }
  }, [assets, toast])

  // La riconferma parte all'apertura della scheda: è il momento naturale.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await requireAuth(`Apri "${doc.title}" per vedere immagini e dati completi.`)
      if (cancelled) return
      setRevealed(ok)
      if (ok && assets.length > 0) await loadAssets()
    })()
    return () => {
      cancelled = true
    }
    // Volutamente legato solo al documento: non vogliamo richiedere di nuovo
    // l'identità a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    return () => {
      for (const url of Object.values(urls)) if (url) URL.revokeObjectURL(url)
    }
  }, [urls])

  /* -------------------------------- azioni -------------------------------- */

  async function shareDocument() {
    const ok = await requireAuth(`Condividi "${doc.title}" con un'altra app.`)
    if (!ok) return
    try {
      const files: File[] = []
      for (const ref of assets) {
        const blob = await archivio.loadAsset(ref)
        files.push(
          new File(
            [blob],
            safeFilename(
              [doc.title, pageLabel(ref.side, assets.indexOf(ref)).toLowerCase()],
              extensionForMime(ref.mime),
            ),
            { type: ref.mime },
          ),
        )
      }
      if (files.length === 0) {
        toast('Questo documento non contiene file da condividere.', 'error')
        return
      }
      const outcome = await shareFiles(files, { title: doc.title })
      if (outcome === 'downloaded') toast('Condivisione non disponibile: file salvati.', 'info')
      else if (outcome === 'shared') toast('Condiviso.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Condivisione non riuscita.', 'error')
    }
  }

  async function shareFieldValue(field: ExtractedField) {
    const ok = await requireAuth(`Condividi ${FIELD_LABELS[field.key]}.`)
    if (!ok) return
    const outcome = await shareText(field.value, FIELD_LABELS[field.key])
    if (outcome === 'copied') toast('Copiato negli appunti.', 'success')
    else if (outcome === 'shared') toast('Condiviso.', 'success')
  }

  /**
   * Il promemoria esce dal caveau, quindi passa dalla riconferma come una
   * condivisione: contiene comunque solo titolo (o categoria) e data.
   */
  async function addToCalendar() {
    const ok = await requireAuth('Crea un promemoria di scadenza nel calendario.')
    if (!ok) return
    const result = buildReminders([doc], {
      anonymous: snapshot.settings.calendarAnonymous,
      ownerName: ownerName,
    })
    if (!result) {
      toast('Questo documento non ha una data di scadenza.', 'error')
      return
    }
    const outcome = await deliverReminders(result)
    if (outcome === 'downloaded') toast('File .ics salvato: aprilo per aggiungerlo al calendario.', 'info')
    else if (outcome === 'shared') toast('Promemoria inviato al calendario.', 'success')
  }

  async function saveFields(next: ExtractedField[]) {
    const expiryField = next.find((f) => f.key === 'expiryDate')
    await archivio.saveDocument({
      ...doc,
      fields: next,
      expiryDate: expiryField?.value || undefined,
    })
    toast('Modifiche salvate.', 'success')
  }

  const missingFields = useMemo(
    () => FIELD_ORDER.filter((key) => !doc.fields.some((f) => f.key === key)),
    [doc.fields],
  )

  /* --------------------------------- vista -------------------------------- */

  return (
    <>
      <Sheet open onClose={onClose} title={doc.title}>
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <span
              className="badge"
              style={{
                background: `color-mix(in srgb, var(--cat-${def.accent}) 16%, transparent)`,
                color: `var(--cat-${def.accent})`,
              }}
            >
              {def.label}
            </span>
            {ownerName && <span className="badge">{ownerName}</span>}
            {expiry.state !== 'none' && (
              <span
                className={`badge ${
                  expiry.state === 'expired'
                    ? 'badge-danger'
                    : expiry.state === 'soon'
                      ? 'badge-warning'
                      : 'badge-success'
                }`}
              >
                <Icon name="clock" size={12} />
                {expiry.label}
              </span>
            )}
          </div>

          {/* ------------------------------ anteprima ---------------------- */}
          {assets.length > 0 && (
            <>
              {assets.length > 1 &&
                (def.multiPage ? (
                  <div className="page-nav" role="group" aria-label="Pagina del documento">
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Pagina precedente"
                      disabled={pageIndex === 0}
                      onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                    >
                      <Icon name="chevron-left" size={18} />
                    </button>
                    <span className="page-nav-label">
                      {pageLabel('page', pageIndex, assets.length)}
                    </span>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Pagina successiva"
                      disabled={pageIndex >= assets.length - 1}
                      onClick={() => setPageIndex((i) => Math.min(assets.length - 1, i + 1))}
                    >
                      <Icon name="chevron-right" size={18} />
                    </button>
                  </div>
                ) : (
                  <div className="side-tabs" role="group" aria-label="Faccia del documento">
                    {assets.map((asset, index) => (
                      <button
                        key={asset.id}
                        type="button"
                        aria-pressed={pageIndex === index}
                        onClick={() => setPageIndex(index)}
                      >
                        {pageLabel(asset.side, index)}
                      </button>
                    ))}
                  </div>
                ))}

              <div className="preview">
                {loading ? (
                  <Spinner label="Decifratura…" />
                ) : revealed && current && urls[current.id] ? (
                  <img
                    src={urls[current.id]}
                    alt={`${doc.title} — ${pageLabel(current.side, pageIndex, assets.length)}`}
                  />
                ) : (
                  <div className="preview-empty">
                    <Icon name="lock" size={26} />
                    <span>Contenuto protetto</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        const ok = await requireAuth(`Apri "${doc.title}".`)
                        setRevealed(ok)
                        if (ok) await loadAssets()
                      }}
                    >
                      Autenticati per vedere
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---------------------------- credenziali ---------------------- */}
          {doc.credential && (
            <div className="list-group">
              {doc.credential.username && (
                <div className="field-row">
                  <div className="field-row-body">
                    <div className="field-row-label">Utente</div>
                    <div className="field-row-value">{doc.credential.username}</div>
                  </div>
                  <div className="field-actions">
                    <CopyButton value={doc.credential.username} label="utente" />
                  </div>
                </div>
              )}
              {doc.credential.password && (
                <div className="field-row">
                  <div className="field-row-body">
                    <div className="field-row-label">Password</div>
                    <div className="field-row-value" data-masked={!showSecret}>
                      {showSecret ? doc.credential.password : '••••••••••'}
                    </div>
                  </div>
                  <div className="field-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={showSecret ? 'Nascondi password' : 'Mostra password'}
                      onClick={async () => {
                        if (showSecret) {
                          setShowSecret(false)
                          return
                        }
                        const ok = await requireAuth('Mostra la password in chiaro.')
                        setShowSecret(ok)
                      }}
                    >
                      <Icon name={showSecret ? 'eye-off' : 'eye'} size={17} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Copia password"
                      onClick={async () => {
                        const ok = await requireAuth('Copia la password negli appunti.')
                        if (!ok) return
                        const copied = await copyText(doc.credential?.password ?? '')
                        toast(copied ? 'Password copiata.' : 'Copia non riuscita.', copied ? 'success' : 'error')
                      }}
                    >
                      <Icon name="copy" size={17} />
                    </button>
                  </div>
                </div>
              )}
              {doc.credential.url && (
                <div className="field-row">
                  <div className="field-row-body">
                    <div className="field-row-label">Servizio</div>
                    <div className="field-row-value">{doc.credential.url}</div>
                  </div>
                  <div className="field-actions">
                    <CopyButton value={doc.credential.url} label="indirizzo" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------- dati riconosciuti ------------------- */}
          {doc.fields.length > 0 ? (
            <div className="list-group">
              {doc.fields.map((field) => (
                <div className="field-row" key={field.key}>
                  <div className="field-row-body">
                    <div className="field-row-label">
                      {FIELD_LABELS[field.key]}
                      {field.source === 'mrz' && (
                        <span className="verified-dot" title="Verificato dalla banda MRZ" />
                      )}
                      {field.confidence < 0.65 && field.source !== 'manual' && (
                        <span className="low-confidence" title="Confidenza bassa: controlla il dato">
                          <Icon name="alert" size={12} />
                        </span>
                      )}
                    </div>
                    <div className="field-row-value">
                      {DATE_FIELDS.has(field.key) ? formatIsoDate(field.value) : field.value}
                    </div>
                  </div>
                  <div className="field-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={
                        archivio.isPinned(doc.id, field.key)
                          ? `Togli ${FIELD_LABELS[field.key]} dai dati rapidi`
                          : `Aggiungi ${FIELD_LABELS[field.key]} ai dati rapidi`
                      }
                      title="Dati rapidi in dashboard"
                      style={{
                        color: archivio.isPinned(doc.id, field.key) ? 'var(--accent)' : undefined,
                      }}
                      onClick={async () => {
                        const added = await archivio.togglePinnedField(doc.id, field.key)
                        toast(
                          added
                            ? `${FIELD_LABELS[field.key]} tra i dati rapidi.`
                            : 'Rimosso dai dati rapidi.',
                          added ? 'success' : 'info',
                        )
                      }}
                    >
                      <Icon name="sparkle" size={17} />
                    </button>
                    <CopyButton value={field.value} label={FIELD_LABELS[field.key]} />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Condividi ${FIELD_LABELS[field.key]}`}
                      onClick={() => shareFieldValue(field)}
                    >
                      <Icon name="share" size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="scan"
              title="Nessun dato estratto"
              text="Puoi inserire i campi a mano: restano cifrati come tutto il resto."
            />
          )}

          {doc.notes && (
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Note
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{doc.notes}</p>
            </div>
          )}

          <p className="dim" style={{ fontSize: 'var(--text-xs)' }}>
            Aggiunto il {formatTimestamp(doc.createdAt)}
            {doc.updatedAt !== doc.createdAt && ` · modificato il ${formatTimestamp(doc.updatedAt)}`}
          </p>

          {/* -------------------------------- azioni ----------------------- */}
          <div className="stack-sm">
            <button type="button" className="btn btn-primary btn-block" onClick={shareDocument}>
              <Icon name="share" size={18} />
              Condividi documento
            </button>
            {expiry.state !== 'none' && (
              <button type="button" className="btn btn-secondary btn-block" onClick={addToCalendar}>
                <Icon name="calendar" size={17} />
                Ricordami la scadenza
              </button>
            )}
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn-secondary grow"
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size={17} />
                Correggi dati
              </button>
              <button
                type="button"
                className="btn btn-secondary grow"
                onClick={() => setAddingField(true)}
                disabled={missingFields.length === 0}
              >
                <Icon name="plus" size={17} />
                Aggiungi campo
              </button>
            </div>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={17} />
              Elimina documento
            </button>
          </div>
        </div>
      </Sheet>

      {editing && (
        <FieldEditor
          fields={doc.fields}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            await saveFields(next)
            setEditing(false)
          }}
        />
      )}

      {addingField && (
        <AddFieldSheet
          available={missingFields}
          onCancel={() => setAddingField(false)}
          onAdd={async (key, value) => {
            await saveFields([
              ...doc.fields,
              { key, value, confidence: 1, source: 'manual' },
            ])
            setAddingField(false)
          }}
        />
      )}

      <ConfirmSheet
        open={confirmDelete}
        title="Eliminare il documento?"
        destructive
        confirmLabel="Elimina"
        body={
          <>
            «{doc.title}» e le sue immagini verranno cancellati definitivamente da questo
            dispositivo. L'operazione non è annullabile.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await archivio.deleteDocument(doc.id)
          setConfirmDelete(false)
          toast('Documento eliminato.', 'success')
          onClose()
        }}
      />
    </>
  )
}

/* ---------------------------- correzione dei campi ------------------------ */

function FieldEditor({
  fields,
  onSave,
  onCancel,
}: {
  fields: ExtractedField[]
  onSave: (next: ExtractedField[]) => void | Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(fields)
  const [saving, setSaving] = useState(false)

  return (
    <Sheet open onClose={onCancel} title="Correggi i dati">
      <p className="sheet-body">
        Le correzioni manuali vengono marcate come verificate e non verranno sovrascritte da una
        nuova lettura OCR.
      </p>
      <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
        {draft.map((field) => (
          <div className="field" key={field.key}>
            <label className="label" htmlFor={`edit-${field.key}`}>
              {FIELD_LABELS[field.key]}
            </label>
            <div className="row">
              <input
                id={`edit-${field.key}`}
                className="input"
                type={DATE_FIELDS.has(field.key) ? 'date' : 'text'}
                value={field.value}
                onChange={(e) =>
                  setDraft((current) =>
                    current.map((f) =>
                      f.key === field.key
                        ? { ...f, value: e.target.value, source: 'manual', confidence: 1 }
                        : f,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="btn-icon"
                aria-label={`Rimuovi ${FIELD_LABELS[field.key]}`}
                onClick={() => setDraft((current) => current.filter((f) => f.key !== field.key))}
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Annulla
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await onSave(draft.filter((f) => f.value.trim() !== ''))
            setSaving(false)
          }}
        >
          Salva
        </button>
      </div>
    </Sheet>
  )
}

/* ----------------------------- aggiunta manuale -------------------------- */

function AddFieldSheet({
  available,
  onAdd,
  onCancel,
}: {
  available: FieldKey[]
  onAdd: (key: FieldKey, value: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [key, setKey] = useState<FieldKey>(available[0])
  const [value, setValue] = useState('')

  return (
    <Sheet open onClose={onCancel} title="Aggiungi un campo">
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="new-field-key">
            Tipo di dato
          </label>
          <select
            id="new-field-key"
            className="select"
            value={key}
            onChange={(e) => setKey(e.target.value as FieldKey)}
          >
            {available.map((k) => (
              <option key={k} value={k}>
                {FIELD_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="new-field-value">
            Valore
          </label>
          <input
            id="new-field-value"
            className="input"
            type={DATE_FIELDS.has(key) ? 'date' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annulla
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!value.trim()}
          onClick={() => onAdd(key, value.trim())}
        >
          Aggiungi
        </button>
      </div>
    </Sheet>
  )
}
