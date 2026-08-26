/**
 * Caricamento in blocco: più immagini in un colpo, elaborate in coda.
 *
 * Risolve il momento in cui l'app si perde: la prima volta, con dieci o quindici
 * documenti da inserire uno alla volta. Qui si scelgono tutte le immagini, l'app
 * fa da sé ritaglio, raddrizzamento, OCR, riconoscimento della categoria e
 * accorpamento fronte/retro, e l'utente conferma un elenco già compilato.
 *
 * Regola che non cambia: **niente viene salvato prima della conferma**. Le
 * ipotesi dell'app sono ipotesi, e alcune saranno sbagliate.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, category as categoryDef } from '../lib/categories'
import { classifyDocument, groupPages, guessSide } from '../lib/classify'
import { randomId } from '../lib/crypto'
import { extractFields } from '../lib/extract'
import { parseMrz } from '../lib/mrz'
import { recognize } from '../lib/ocr'
import { canvasToBlob, isPdf, pdfFirstPageToBlob } from '../lib/pdf'
import { blobToCanvas, detectDocument, warpDocument } from '../lib/scan'
import { archivio } from '../lib/archivio'
import { suggestedTitle } from '../lib/format'
import type { AssetRef, CategoryId, ExtractedField, Side } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { CameraCapture } from './CameraCapture'
import { Icon } from './Icon'
import { Progress, Sheet, Spinner } from './ui'

interface ProcessedPage {
  id: string
  /** Immagine finale, già raddrizzata quando il bordo è stato trovato. */
  blob: Blob
  previewUrl: string
  text: string
  fields: ExtractedField[]
  category: CategoryId
  categoryConfidence: number
  categoryReason: string
  side: Side
  cropped: boolean
}

interface Proposal {
  id: string
  category: CategoryId
  title: string
  pages: ProcessedPage[]
  fields: ExtractedField[]
  include: boolean
  /** Confidenza del riconoscimento della categoria: guida l'avviso in UI. */
  confidence: number
  reason: string
}

export interface BatchImportProps {
  profileId: string
  profileName?: string
  onClose: () => void
  onSaved: (count: number) => void
}

type Phase = 'pick' | 'working' | 'review' | 'saving'

export function BatchImport({ profileId, profileName, onClose, onSaved }: BatchImportProps) {
  const { toast } = useArchivio()
  const [phase, setPhase] = useState<Phase>('pick')
  const [queue, setQueue] = useState<Blob[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [camera, setCamera] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url)
    },
    [],
  )

  /* ------------------------------ elaborazione ---------------------------- */

  async function processOne(source: Blob, index: number, total: number): Promise<ProcessedPage> {
    const step = (label: string) => setProgress({ current: index + 1, total, label })

    // I PDF non si ritagliano: si rasterizza la prima pagina.
    let working = source
    let cropped = false
    if (isPdf(source)) {
      step('Lettura del PDF')
      working = (await pdfFirstPageToBlob(source)).blob
    } else {
      step('Ricerca del bordo')
      const canvas = await blobToCanvas(source)
      const detection = detectDocument(canvas)
      if (detection) {
        working = await canvasToBlob(warpDocument(canvas, detection.quad), 'image/jpeg', 0.94)
        cropped = true
      }
    }

    step('Lettura del testo')
    // La passata MRZ va sempre fatta: la categoria non è ancora nota, e la MRZ
    // è proprio uno dei segnali che la determinano.
    const result = await recognize(working, { mrzPass: true })
    const text = [result.text, result.mrzText].filter(Boolean).join('\n')

    const mrz = parseMrz(text)
    const classification = classifyDocument(text, mrz)
    const side = guessSide(text, classification.category, mrz)
    const fields = extractFields(
      side.side === 'back' ? { back: text } : { front: text },
    )

    const previewUrl = URL.createObjectURL(working)
    urls.current.push(previewUrl)

    return {
      id: randomId(),
      blob: working,
      previewUrl,
      text,
      fields,
      category: classification.category,
      categoryConfidence: classification.confidence,
      categoryReason: classification.reason,
      side: side.side,
      cropped,
    }
  }

  async function run() {
    if (queue.length === 0) return
    setPhase('working')
    setError(null)
    const pages: ProcessedPage[] = []
    try {
      for (let i = 0; i < queue.length; i++) {
        pages.push(await processOne(queue[i], i, queue.length))
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Elaborazione interrotta: ${err.message}`
          : 'Elaborazione interrotta.',
      )
    }

    // Accorpamento delle coppie consecutive fronte/retro.
    const groups = groupPages(pages)
    setProposals(
      groups.map((group) => {
        const front = group.find((p) => p.side === 'front')
        const back = group.find((p) => p.side === 'back')
        const merged = extractFields({ front: front?.text, back: back?.text })
        const best = group.reduce((a, b) => (a.categoryConfidence >= b.categoryConfidence ? a : b))
        return {
          id: randomId(),
          category: best.category,
          title: suggestedTitle(categoryDef(best.category).label, profileName),
          pages: group,
          fields: merged,
          include: true,
          confidence: best.categoryConfidence,
          reason: best.categoryReason,
        }
      }),
    )
    setPhase('review')
  }

  /* -------------------------------- modifiche ----------------------------- */

  function update(id: string, patch: Partial<Proposal>) {
    setProposals((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  /** Separa una coppia accorpata per errore. */
  function split(id: string) {
    setProposals((current) => {
      const index = current.findIndex((p) => p.id === id)
      if (index < 0 || current[index].pages.length < 2) return current
      const source = current[index]
      const singles = source.pages.map((page) => ({
        id: randomId(),
        category: page.category,
        title: suggestedTitle(categoryDef(page.category).label, profileName),
        pages: [page],
        fields: extractFields(page.side === 'back' ? { back: page.text } : { front: page.text }),
        include: true,
        confidence: page.categoryConfidence,
        reason: page.categoryReason,
      }))
      return [...current.slice(0, index), ...singles, ...current.slice(index + 1)]
    })
  }

  /** Unisce una scheda alla precedente, quando l'accorpamento non è scattato. */
  function mergeWithPrevious(id: string) {
    setProposals((current) => {
      const index = current.findIndex((p) => p.id === id)
      if (index <= 0) return current
      const previous = current[index - 1]
      const target = current[index]
      if (previous.pages.length + target.pages.length > 2) return current

      // La faccia della seconda pagina viene forzata a complementare: se l'app
      // aveva sbagliato a riconoscerla, è questo il momento di correggerla.
      const pages = [...previous.pages, ...target.pages]
      const first = { ...pages[0], side: 'front' as Side }
      const second = { ...pages[1], side: 'back' as Side }
      const merged: Proposal = {
        ...previous,
        pages: [first, second],
        fields: extractFields({ front: first.text, back: second.text }),
      }
      return [...current.slice(0, index - 1), merged, ...current.slice(index + 1)]
    })
  }

  /* ------------------------------- salvataggio ---------------------------- */

  async function saveAll() {
    const selected = proposals.filter((p) => p.include)
    if (selected.length === 0) return
    setPhase('saving')
    setError(null)
    try {
      for (const proposal of selected) {
        const refs: AssetRef[] = []
        for (const page of proposal.pages) {
          refs.push(await archivio.saveAsset(page.blob, page.side, { isPdf: false }))
        }
        const now = Date.now()
        const expiry = proposal.fields.find((f) => f.key === 'expiryDate')?.value
        await archivio.saveDocument({
          id: randomId(),
          profileId,
          category: proposal.category,
          title: proposal.title.trim() || categoryDef(proposal.category).label,
          assets: refs,
          fields: proposal.fields,
          expiryDate: expiry || undefined,
          ocrStatus: 'done',
          ocrRawText: proposal.pages.map((p) => p.text).join('\n---\n'),
          createdAt: now,
          updatedAt: now,
        })
      }
      toast(
        selected.length === 1
          ? 'Documento archiviato e cifrato.'
          : `${selected.length} documenti archiviati e cifrati.`,
        'success',
      )
      onSaved(selected.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito.')
      setPhase('review')
    }
  }

  const includedCount = useMemo(() => proposals.filter((p) => p.include).length, [proposals])

  /* ---------------------------------- vista ------------------------------- */

  return (
    <>
      <Sheet open onClose={onClose} title={titleFor(phase, queue.length)}>
        {error && (
          <p className="form-error" style={{ marginBottom: 'var(--space-4)' }}>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}

        {phase === 'pick' && (
          <div className="stack">
            <p className="sheet-body">
              Scegli tutte le immagini in una volta: l'app le raddrizza, ne legge il testo, riconosce
              la categoria e unisce fronte e retro. Poi controlli e salvi.
            </p>

            {queue.length > 0 && (
              <div className="card card-pad row-between">
                <span>
                  <strong>{queue.length}</strong>{' '}
                  {queue.length === 1 ? 'immagine in coda' : 'immagini in coda'}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQueue([])}>
                  Svuota
                </button>
              </div>
            )}

            <button type="button" className="choice-card" onClick={() => fileInput.current?.click()}>
              <span className="choice-icon">
                <Icon name="image" size={22} />
              </span>
              <span className="grow">
                <span className="choice-title">Scegli immagini o PDF</span>
                <span className="choice-desc">Selezione multipla dalla galleria o dai file.</span>
              </span>
            </button>

            <button type="button" className="choice-card" onClick={() => setCamera(true)}>
              <span className="choice-icon">
                <Icon name="camera" size={22} />
              </span>
              <span className="grow">
                <span className="choice-title">Scatta in sequenza</span>
                <span className="choice-desc">
                  Fotografa un documento dopo l'altro; fronte e retro consecutivi vengono uniti.
                </span>
              </span>
            </button>

            <div className="sheet-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Annulla
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={queue.length === 0}
                onClick={run}
              >
                Elabora {queue.length > 0 ? queue.length : ''}
              </button>
            </div>
          </div>
        )}

        {phase === 'working' && (
          <div className="stack">
            <Progress
              value={progress.total ? (progress.current - 1) / progress.total : 0}
              label={`Immagine ${progress.current} di ${progress.total} · ${progress.label}`}
            />
            <p className="input-hint">
              L'elaborazione avviene sul dispositivo, quindi richiede qualche secondo per immagine.
              Non chiudere questa schermata.
            </p>
          </div>
        )}

        {phase === 'review' && (
          <div className="stack">
            <p className="sheet-body">
              {proposals.length === 1
                ? 'Un documento riconosciuto. Controlla e salva.'
                : `${proposals.length} documenti riconosciuti. Controlla categoria e titolo, poi salva.`}
            </p>

            {proposals.map((proposal, index) => (
              <div className="card card-pad stack" key={proposal.id}>
                <div className="row-between">
                  <label className="row" style={{ gap: 'var(--space-2)' }}>
                    <input
                      type="checkbox"
                      checked={proposal.include}
                      onChange={(e) => update(proposal.id, { include: e.target.checked })}
                      aria-label="Includi questo documento"
                    />
                    <span className="eyebrow">
                      {proposal.pages.length === 2 ? 'Fronte + retro' : 'Una facciata'}
                    </span>
                  </label>
                  <span className="badge">
                    {proposal.fields.length}{' '}
                    {proposal.fields.length === 1 ? 'dato' : 'dati'}
                  </span>
                </div>

                <div className="capture-slots">
                  {proposal.pages.map((page) => (
                    <div className="capture-slot" data-filled="true" key={page.id}>
                      <img src={page.previewUrl} alt={page.side === 'back' ? 'Retro' : 'Fronte'} />
                      <span className="capture-slot-badge">
                        {page.side === 'back' ? 'Retro' : 'Fronte'}
                        {page.cropped ? ' · raddrizzato' : ''}
                      </span>
                    </div>
                  ))}
                </div>

                {proposal.confidence < 0.6 && (
                  <p className="input-hint" style={{ color: 'var(--warning)' }}>
                    <Icon name="alert" size={13} /> {proposal.reason}
                  </p>
                )}

                <div className="field">
                  <label className="label" htmlFor={`cat-${proposal.id}`}>
                    Categoria
                  </label>
                  <select
                    id={`cat-${proposal.id}`}
                    className="select"
                    value={proposal.category}
                    onChange={(e) => {
                      const next = e.target.value as CategoryId
                      update(proposal.id, {
                        category: next,
                        title: suggestedTitle(categoryDef(next).label, profileName),
                      })
                    }}
                  >
                    {CATEGORIES.filter((c) => !c.secretsOnly).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="label" htmlFor={`title-${proposal.id}`}>
                    Titolo
                  </label>
                  <input
                    id={`title-${proposal.id}`}
                    className="input"
                    value={proposal.title}
                    onChange={(e) => update(proposal.id, { title: e.target.value })}
                  />
                </div>

                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  {proposal.pages.length === 2 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm grow"
                      onClick={() => split(proposal.id)}
                    >
                      <Icon name="flip" size={15} />
                      Separa
                    </button>
                  )}
                  {proposal.pages.length === 1 &&
                    index > 0 &&
                    proposals[index - 1].pages.length === 1 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm grow"
                        onClick={() => mergeWithPrevious(proposal.id)}
                      >
                        <Icon name="plus" size={15} />
                        Unisci al precedente
                      </button>
                    )}
                </div>
              </div>
            ))}

            <div className="sheet-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Annulla
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={includedCount === 0}
                onClick={saveAll}
              >
                Salva {includedCount}
              </button>
            </div>
          </div>
        )}

        {phase === 'saving' && (
          <div style={{ padding: 'var(--space-8)', display: 'grid', placeItems: 'center' }}>
            <Spinner label="Cifratura e salvataggio…" />
          </div>
        )}
      </Sheet>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) setQueue((current) => [...current, ...files])
        }}
      />

      {camera && (
        <CameraCapture
          sideLabel={`Immagine ${queue.length + 1}`}
          onCancel={() => setCamera(false)}
          onCapture={(blob) => {
            setQueue((current) => [...current, blob])
            // Resta in fotocamera: chi scatta in sequenza non vuole riaprirla
            // per ogni facciata. Si esce con Annulla.
            setCamera(false)
            window.setTimeout(() => setCamera(true), 60)
          }}
        />
      )}
    </>
  )
}

function titleFor(phase: Phase, queued: number): string {
  if (phase === 'pick') return 'Aggiungi più documenti'
  if (phase === 'working') return `Elaborazione di ${queued} immagini`
  if (phase === 'saving') return 'Salvataggio'
  return 'Controlla e salva'
}
