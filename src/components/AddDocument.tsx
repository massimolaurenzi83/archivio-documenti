/**
 * Aggiunta di un documento: categoria, acquisizione fronte/retro, OCR, revisione.
 *
 * Il flusso è pensato per il telefono: si scatta il fronte, si gira il documento,
 * si scatta il retro, l'OCR gira mentre l'utente scrive il titolo. Nulla lascia
 * il dispositivo in nessun momento.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, category } from '../lib/categories'
import { extractFields, DATE_FIELDS, FIELD_LABELS } from '../lib/extract'
import { isOcrSupported, recognize, type OcrProgress } from '../lib/ocr'
import { isPdf, pdfFirstPageToBlob } from '../lib/pdf'
import { randomId } from '../lib/crypto'
import { archivio } from '../lib/archivio'
import { suggestedTitle } from '../lib/format'
import type { AssetRef, CategoryId, ExtractedField, Side, ArchivioDocument } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { CameraCapture } from './CameraCapture'
import { CropSheet } from './CropSheet'
import { Icon } from './Icon'
import { Progress, Sheet, Spinner } from './ui'

interface StagedAsset {
  side: Side
  file: Blob
  /** Anteprima da mostrare: per i PDF è la prima pagina renderizzata. */
  previewUrl: string
  /** Immagine su cui far girare l'OCR (per i PDF, la pagina renderizzata). */
  ocrSource: Blob
  isPdf: boolean
  text?: string
}

export interface AddDocumentProps {
  profileId: string
  profileName?: string
  initialCategory?: CategoryId
  onClose: () => void
  onSaved: (doc: ArchivioDocument) => void
}

type Step = 'category' | 'capture' | 'review'

export function AddDocument({
  profileId,
  profileName,
  initialCategory,
  onClose,
  onSaved,
}: AddDocumentProps) {
  const { snapshot, toast } = useArchivio()
  const [step, setStep] = useState<Step>(initialCategory ? 'capture' : 'category')
  const [categoryId, setCategoryId] = useState<CategoryId>(initialCategory ?? 'identity_card')
  const [staged, setStaged] = useState<StagedAsset[]>([])
  const [cameraSide, setCameraSide] = useState<Side | null>(null)
  const [pickerSide, setPickerSide] = useState<Side | null>(null)
  /** Immagine in attesa di conferma del ritaglio. */
  const [cropping, setCropping] = useState<{ side: Side; blob: Blob } | null>(null)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [credential, setCredential] = useState({ username: '', password: '', url: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const urlsRef = useRef<string[]>([])

  const def = category(categoryId)

  // Ogni URL creato va revocato all'uscita, altrimenti i blob restano in memoria.
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
    }
  }, [])

  const front = staged.find((s) => s.side === 'front')
  const back = staged.find((s) => s.side === 'back')

  /* ------------------------------ acquisizione ----------------------------- */

  /**
   * Le immagini passano dalla conferma del ritaglio: una foto scattata a mano
   * libera è quasi sempre inclinata, e raddrizzarla cambia radicalmente la resa
   * dell'OCR. I PDF no: sono già pagine rettangolari.
   */
  async function receive(side: Side, file: Blob) {
    setError(null)
    if (!isPdf(file)) {
      setCropping({ side, blob: file })
      return
    }
    await stage(side, file)
  }

  async function stage(side: Side, file: Blob) {
    setError(null)
    try {
      let ocrSource = file
      let previewBlob = file
      const pdf = isPdf(file)
      if (pdf) {
        const rendered = await pdfFirstPageToBlob(file)
        ocrSource = rendered.blob
        previewBlob = rendered.blob
      }
      const previewUrl = URL.createObjectURL(previewBlob)
      urlsRef.current.push(previewUrl)
      setStaged((current) => [
        ...current.filter((s) => s.side !== side),
        { side, file, previewUrl, ocrSource, isPdf: pdf },
      ])
    } catch {
      setError('Il file selezionato non è leggibile. Prova con un altro formato.')
    }
  }

  function unstage(side: Side) {
    setStaged((current) => current.filter((s) => s.side !== side))
    setFields([])
  }

  /* ---------------------------------- OCR --------------------------------- */

  const runOcr = async (assets: StagedAsset[]) => {
    if (!isOcrSupported() || assets.length === 0) return assets
    const updated: StagedAsset[] = []
    for (const asset of assets) {
      try {
        const result = await recognize(asset.ocrSource, {
          // La MRZ sta sul retro della CIE e nella pagina dati del passaporto.
          mrzPass: def.mrz,
          onProgress: setOcrProgress,
        })
        const text = [result.text, result.mrzText].filter(Boolean).join('\n')
        updated.push({ ...asset, text })
      } catch (err) {
        console.warn('[ocr] lettura non riuscita', err)
        updated.push(asset)
      }
    }
    setOcrProgress(null)
    return updated
  }

  async function goToReview() {
    setStep('review')
    if (!title) setTitle(suggestedTitle(def.label, profileName))
    if (def.secretsOnly || staged.length === 0) return

    if (snapshot.settings.ocrAutoRun && isOcrSupported()) {
      const updated = await runOcr(staged)
      setStaged(updated)
      setFields(
        extractFields({
          front: updated.find((s) => s.side === 'front')?.text,
          back: updated.find((s) => s.side === 'back')?.text,
        }),
      )
    }
  }

  async function rerunOcr() {
    const updated = await runOcr(staged)
    setStaged(updated)
    const next = extractFields({
      front: updated.find((s) => s.side === 'front')?.text,
      back: updated.find((s) => s.side === 'back')?.text,
    })
    // Le correzioni manuali già fatte non vanno perse.
    const manual = fields.filter((f) => f.source === 'manual')
    setFields([...next.filter((f) => !manual.some((m) => m.key === f.key)), ...manual])
    toast(next.length ? `${next.length} campi riconosciuti.` : 'Nessun campo riconosciuto.', 'info')
  }

  /* -------------------------------- salvataggio ---------------------------- */

  const expiryValue = useMemo(
    () => fields.find((f) => f.key === 'expiryDate')?.value ?? '',
    [fields],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const refs: AssetRef[] = []
      for (const asset of staged) {
        const ref = await archivio.saveAsset(asset.file, asset.side, { isPdf: asset.isPdf })
        refs.push(ref)
      }
      const now = Date.now()
      const doc: ArchivioDocument = {
        id: randomId(),
        profileId,
        category: categoryId,
        title: title.trim() || def.label,
        notes: notes.trim() || undefined,
        assets: refs,
        fields,
        credential: def.secretsOnly
          ? {
              username: credential.username.trim() || undefined,
              password: credential.password || undefined,
              url: credential.url.trim() || undefined,
            }
          : undefined,
        expiryDate: expiryValue || undefined,
        ocrStatus: staged.some((s) => s.text) ? 'done' : isOcrSupported() ? 'none' : 'unsupported',
        ocrRawText: staged.map((s) => s.text).filter(Boolean).join('\n---\n') || undefined,
        createdAt: now,
        updatedAt: now,
      }
      await archivio.saveDocument(doc)
      toast('Documento archiviato e cifrato.', 'success')
      onSaved(doc)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito.')
    } finally {
      setSaving(false)
    }
  }

  const canProceed = def.secretsOnly ? true : Boolean(front)

  /* ---------------------------------- vista -------------------------------- */

  return (
    <>
      <Sheet open onClose={onClose} title={stepTitle(step, def.label)}>
        {error && (
          <p className="form-error" style={{ marginBottom: 'var(--space-4)' }}>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}

        {step === 'category' && (
          <div className="cat-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cat-tile"
                style={{ ['--cat-color' as string]: `var(--cat-${c.accent})` }}
                onClick={() => {
                  setCategoryId(c.id)
                  setStep('capture')
                }}
              >
                <span className="cat-icon">
                  <Icon name={c.icon as never} size={19} />
                </span>
                <span className="grow">
                  <span className="cat-label">{c.label}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 'capture' && (
          <div className="stack">
            {def.secretsOnly ? (
              <p className="sheet-body">
                Questa categoria conserva credenziali, non immagini. Passa al prossimo passaggio per
                inserirle.
              </p>
            ) : (
              <>
                <p className="sheet-body">
                  Acquisisci il <strong>fronte</strong> e, se il documento ne ha uno,
                  il <strong>retro</strong>. Il retro è dove si trovano MRZ e indirizzo: dà i dati
                  più affidabili.
                </p>

                <div className="capture-slots">
                  <CaptureSlot
                    label="Fronte"
                    asset={front}
                    required
                    onPick={() => setPickerSide('front')}
                    onRemove={() => unstage('front')}
                  />
                  <CaptureSlot
                    label="Retro"
                    asset={back}
                    onPick={() => setPickerSide('back')}
                    onRemove={() => unstage('back')}
                  />
                </div>
              </>
            )}

            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => (initialCategory ? onClose() : setStep('category'))}
              >
                Indietro
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canProceed}
                onClick={goToReview}
              >
                Continua
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="stack">
            {ocrProgress && (
              <div className="card card-pad">
                <Progress value={ocrProgress.progress} label={ocrProgress.label} />
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="doc-title">
                Titolo
              </label>
              <input
                id="doc-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={def.label}
              />
            </div>

            {def.secretsOnly ? (
              <>
                <div className="field">
                  <label className="label" htmlFor="cred-user">
                    Utente o email
                  </label>
                  <input
                    id="cred-user"
                    className="input"
                    autoComplete="off"
                    value={credential.username}
                    onChange={(e) => setCredential({ ...credential, username: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="cred-pass">
                    Password
                  </label>
                  <div className="row">
                    <input
                      id="cred-pass"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={credential.password}
                      onChange={(e) => setCredential({ ...credential, password: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={showPassword ? 'Nascondi' : 'Mostra'}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="cred-url">
                    Sito o servizio
                  </label>
                  <input
                    id="cred-url"
                    className="input"
                    inputMode="url"
                    placeholder="esempio.it"
                    value={credential.url}
                    onChange={(e) => setCredential({ ...credential, url: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="row-between">
                  <span className="eyebrow">Dati riconosciuti</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={rerunOcr}
                    disabled={Boolean(ocrProgress)}
                  >
                    <Icon name="refresh" size={15} />
                    {ocrProgress ? 'Lettura…' : 'Rileggi'}
                  </button>
                </div>

                {fields.length === 0 && !ocrProgress && (
                  <p className="input-hint">
                    Nessun dato riconosciuto automaticamente. Puoi aggiungere i campi a mano dopo il
                    salvataggio, dalla scheda del documento.
                  </p>
                )}

                {fields.length > 0 && (
                  <div className="list-group">
                    {fields.map((field) => (
                      <div className="setting-row" key={field.key}>
                        <div className="setting-row-body">
                          <label className="field-row-label" htmlFor={`f-${field.key}`}>
                            {FIELD_LABELS[field.key]}
                            {field.source === 'mrz' && (
                              <span className="badge badge-success">verificato</span>
                            )}
                            {field.confidence < 0.65 && field.source !== 'manual' && (
                              <span className="badge badge-warning">da controllare</span>
                            )}
                          </label>
                          <input
                            id={`f-${field.key}`}
                            className="input"
                            style={{ marginTop: 'var(--space-2)' }}
                            type={DATE_FIELDS.has(field.key) ? 'date' : 'text'}
                            value={field.value}
                            onChange={(e) =>
                              setFields((current) =>
                                current.map((f) =>
                                  f.key === field.key
                                    ? { ...f, value: e.target.value, source: 'manual', confidence: 1 }
                                    : f,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="field">
              <label className="label" htmlFor="doc-notes">
                Note (opzionale)
              </label>
              <textarea
                id="doc-notes"
                className="textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('capture')}
                disabled={saving}
              >
                Indietro
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <Spinner label="Cifratura…" /> : 'Salva nel caveau'}
              </button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Scelta della sorgente: fotocamera o file già presente sul dispositivo. */}
      <Sheet
        open={pickerSide !== null}
        onClose={() => setPickerSide(null)}
        title={pickerSide === 'back' ? 'Retro del documento' : 'Fronte del documento'}
      >
        <div className="stack">
          <button
            type="button"
            className="choice-card"
            onClick={() => {
              const side = pickerSide
              setPickerSide(null)
              setCameraSide(side)
            }}
          >
            <span className="choice-icon">
              <Icon name="camera" size={22} />
            </span>
            <span className="grow">
              <span className="choice-title">Scatta una foto</span>
              <span className="choice-desc">Usa la fotocamera con la cornice guida.</span>
            </span>
          </button>

          <button type="button" className="choice-card" onClick={() => fileInputRef.current?.click()}>
            <span className="choice-icon">
              <Icon name="image" size={22} />
            </span>
            <span className="grow">
              <span className="choice-title">Scegli un file</span>
              <span className="choice-desc">Immagine o PDF già salvato sul dispositivo.</span>
            </span>
          </button>
        </div>
      </Sheet>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          const side = pickerSide
          e.target.value = ''
          setPickerSide(null)
          if (file && side) await receive(side, file)
        }}
      />

      {cropping && (
        <CropSheet
          image={cropping.blob}
          sideLabel={cropping.side === 'front' ? 'Fronte' : 'Retro'}
          onCancel={() => setCropping(null)}
          onConfirm={async (result) => {
            const side = cropping.side
            setCropping(null)
            await stage(side, result)
          }}
        />
      )}

      {cameraSide && (
        <CameraCapture
          sideLabel={cameraSide === 'front' ? 'Fronte' : 'Retro'}
          onCancel={() => setCameraSide(null)}
          onCapture={async (blob) => {
            const side = cameraSide
            setCameraSide(null)
            if (side) await receive(side, blob)
          }}
        />
      )}
    </>
  )
}

function stepTitle(step: Step, categoryLabel: string): string {
  if (step === 'category') return 'Che documento vuoi archiviare?'
  if (step === 'capture') return categoryLabel
  return 'Controlla e salva'
}

function CaptureSlot({
  label,
  asset,
  required,
  onPick,
  onRemove,
}: {
  label: string
  asset?: StagedAsset
  required?: boolean
  onPick: () => void
  onRemove: () => void
}) {
  if (asset) {
    return (
      <div className="capture-slot" data-filled="true">
        <img src={asset.previewUrl} alt={label} />
        <span className="capture-slot-badge">{label}</span>
        <button
          type="button"
          className="capture-slot-remove"
          aria-label={`Rimuovi ${label}`}
          onClick={onRemove}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    )
  }
  return (
    <button type="button" className="capture-slot" onClick={onPick}>
      <Icon name="camera" size={24} />
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
    </button>
  )
}
