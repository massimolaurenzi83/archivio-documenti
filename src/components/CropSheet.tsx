/**
 * Conferma del ritaglio: mostra il bordo rilevato e lascia correggere i quattro
 * angoli trascinandoli.
 *
 * Il rilevamento automatico è affidabile su un documento appoggiato su un piano
 * di colore diverso, ma non sempre: su un tavolo bianco con una carta bianca
 * nessun algoritmo indovina il bordo. Per questo l'ultima parola è dell'utente,
 * e c'è sempre la via d'uscita "immagine intera".
 *
 * La sovrapposizione è un SVG con `viewBox` pari ai pixel dell'immagine: così gli
 * angoli si esprimono in coordinate dell'immagine e la scala di
 * visualizzazione non entra nei calcoli.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { blobToCanvas, detectDocument, warpDocument, type Point, type Quad } from '../lib/scan'
import { canvasToBlob } from '../lib/pdf'
import { Icon } from './Icon'
import { Sheet, Spinner } from './ui'

export interface CropSheetProps {
  image: Blob
  sideLabel: string
  /** Riceve l'immagine raddrizzata, oppure quella originale se non si ritaglia. */
  onConfirm: (result: Blob) => void
  onCancel: () => void
}

interface Loaded {
  canvas: HTMLCanvasElement
  quad: Quad
  detected: boolean
  skew: number
}

/** Raggio dei pomelli in pixel CSS: sotto i 12 px diventano impossibili col pollice. */
const HANDLE_CSS_RADIUS = 13

/** Altezza massima dell'anteprima: il resto dello schermo serve ai pulsanti. */
const MAX_STAGE_HEIGHT = '44dvh'

export function CropSheet({ image, sideLabel, onConfirm, onCancel }: CropSheetProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [quad, setQuad] = useState<Quad | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  /**
   * L'anteprima è generata dal canvas, non dal file originale.
   *
   * È la garanzia che ciò che si vede e ciò su cui si calcola siano la stessa
   * immagine: mostrando il file grezzo, una foto con orientamento EXIF verrebbe
   * raddrizzata dal browser ma non dal canvas, e gli angoli trascinati
   * finirebbero su una porzione completamente diversa della foto.
   */
  const [preview, setPreview] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const previewUrl = useRef<string | null>(null)

  /* ----------------------------- caricamento ----------------------------- */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const canvas = await blobToCanvas(image)
        const detection = detectDocument(canvas)
        // Senza rilevamento si parte da un rettangolo generoso: l'utente
        // stringe da lì invece di piazzare quattro angoli da zero.
        const fallback: Quad = [
          { x: canvas.width * 0.06, y: canvas.height * 0.06 },
          { x: canvas.width * 0.94, y: canvas.height * 0.06 },
          { x: canvas.width * 0.94, y: canvas.height * 0.94 },
          { x: canvas.width * 0.06, y: canvas.height * 0.94 },
        ]
        if (cancelled) return
        const next: Loaded = {
          canvas,
          quad: detection?.quad ?? fallback,
          detected: Boolean(detection),
          skew: detection?.skewDegrees ?? 0,
        }
        const previewBlob = await canvasToBlob(canvas, 'image/jpeg', 0.9)
        if (cancelled) return
        setLoaded(next)
        setQuad(next.quad)
        previewUrl.current = URL.createObjectURL(previewBlob)
        setPreview(previewUrl.current)
      } catch {
        if (!cancelled) setError('Immagine non leggibile.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [image])

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    },
    [],
  )

  /* --------------------- scala di visualizzazione ------------------------ */

  // Serve solo a mantenere i pomelli della stessa dimensione a schermo,
  // qualunque sia la risoluzione della foto.
  const measure = useCallback(() => {
    const svg = svgRef.current
    if (!svg || !loaded) return
    const rect = svg.getBoundingClientRect()
    if (rect.width > 0) setDisplayScale(loaded.canvas.width / rect.width)
  }, [loaded])

  /*
   * La misura va ripetuta a ogni cambio di dimensione, non fatta una volta
   * sola: al primo passaggio l'immagine non è ancora stata disegnata e il
   * riquadro non ha la sua altezza definitiva. Misurando solo lì, la scala
   * resta 1 e i pomelli vengono disegnati in unità dell'immagine invece che in
   * pixel schermo — su una foto da 12 megapixel diventano puntini di pochi
   * pixel, impossibili da afferrare col dito. Su un telefono nulla scatena poi
   * un `resize` che rimedi.
   */
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(svg)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  /* ------------------------------ trascinamento -------------------------- */

  const toImageCoords = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current
      if (!svg || !loaded) return null
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const x = ((clientX - rect.left) / rect.width) * loaded.canvas.width
      const y = ((clientY - rect.top) / rect.height) * loaded.canvas.height
      return {
        x: Math.max(0, Math.min(loaded.canvas.width, x)),
        y: Math.max(0, Math.min(loaded.canvas.height, y)),
      }
    },
    [loaded],
  )

  useEffect(() => {
    if (dragging === null) return
    const onMove = (event: PointerEvent) => {
      event.preventDefault()
      const point = toImageCoords(event.clientX, event.clientY)
      if (!point) return
      setQuad((current) => {
        if (!current) return current
        const next = [...current] as Quad
        next[dragging] = point
        return next
      })
    }
    const onUp = () => setDragging(null)
    // `passive: false` perché su mobile serve bloccare lo scroll della pagina
    // mentre si trascina un angolo.
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, toImageCoords])

  /* --------------------------------- azioni ------------------------------ */

  async function applyCrop() {
    if (!loaded || !quad) return
    setBusy(true)
    try {
      const warped = warpDocument(loaded.canvas, quad)
      // JPEG di qualità alta: il PNG di una foto raddoppierebbe lo spazio
      // occupato nel caveau senza guadagno visibile.
      onConfirm(await canvasToBlob(warped, 'image/jpeg', 0.94))
    } catch {
      setError('Raddrizzamento non riuscito: usa l’immagine intera.')
      setBusy(false)
    }
  }

  const handleRadius = HANDLE_CSS_RADIUS * displayScale
  const strokeWidth = Math.max(1.5, 2 * displayScale)

  return (
    <Sheet open onClose={onCancel} title={`Ritaglio ${sideLabel.toLowerCase()}`}>
      {!loaded ? (
        <div style={{ padding: 'var(--space-8)', display: 'grid', placeItems: 'center' }}>
          <Spinner label="Analisi dell'immagine…" />
        </div>
      ) : (
        <div className="stack">
          <p className="sheet-body">
            {loaded.detected
              ? Math.abs(loaded.skew) >= 1
                ? `Bordo rilevato, inclinazione ${Math.abs(loaded.skew).toFixed(0)}°. Correggi gli angoli se serve, poi premi «Ritaglia e raddrizza».`
                : 'Bordo rilevato. Correggi gli angoli se serve, poi premi «Ritaglia e raddrizza».'
              : 'Bordo non rilevato: trascina i quattro angoli sui vertici del documento, poi premi «Ritaglia e raddrizza».'}
          </p>

          {/*
            Il riquadro non deve superare in altezza una frazione dello schermo,
            altrimenti su una foto verticale i pulsanti finiscono sotto il bordo
            e l'azione principale sembra non esistere. Il limite si esprime sulla
            larghezza, ricavandolo dall'aspetto: così l'immagine resta a
            larghezza piena del riquadro e la sovrapposizione SVG le combacia.
          */}
          <div
            className="crop-stage"
            style={{
              maxWidth: `min(100%, calc(${MAX_STAGE_HEIGHT} * ${(
                loaded.canvas.width / loaded.canvas.height
              ).toFixed(4)}))`,
            }}
          >
            {preview && (
              <img src={preview} alt={`Ritaglio ${sideLabel}`} onLoad={measure} />
            )}
            <svg
              ref={svgRef}
              className="crop-overlay"
              viewBox={`0 0 ${loaded.canvas.width} ${loaded.canvas.height}`}
              preserveAspectRatio="none"
              onLoad={measure}
            >
              {/* Maschera: fuori dal quadrilatero l'immagine è scurita. */}
              <defs>
                <mask id="crop-mask">
                  <rect
                    x="0"
                    y="0"
                    width={loaded.canvas.width}
                    height={loaded.canvas.height}
                    fill="white"
                  />
                  {quad && <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} fill="black" />}
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width={loaded.canvas.width}
                height={loaded.canvas.height}
                fill="rgba(4, 6, 12, 0.62)"
                mask="url(#crop-mask)"
              />
              {quad && (
                <>
                  <polygon
                    points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={strokeWidth}
                  />
                  {quad.map((point, index) => (
                    <g key={index}>
                      {/* Cerchio invisibile più largo: area di tocco comoda. */}
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={handleRadius * 1.9}
                        fill="transparent"
                        style={{ cursor: 'grab', touchAction: 'none' }}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          setDragging(index)
                        }}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={handleRadius}
                        fill="var(--accent)"
                        stroke="#fff"
                        strokeWidth={strokeWidth}
                        pointerEvents="none"
                        opacity={dragging === index ? 1 : 0.92}
                      />
                    </g>
                  ))}
                </>
              )}
            </svg>
          </div>

          {error && (
            <p className="form-error">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </p>
          )}

          <div className="sticky-actions">
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={applyCrop}
              disabled={busy}
            >
              {busy ? <Spinner label="Raddrizzamento…" /> : <><Icon name="scan" size={18} />Ritaglia e raddrizza</>}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={busy}
              onClick={() => onConfirm(image)}
            >
              Usa l’immagine intera
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
              Annulla
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
