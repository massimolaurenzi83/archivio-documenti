/**
 * Anteprima e rasterizzazione dei PDF con pdf.js, servito localmente.
 *
 * Serve a due cose: mostrare la prima pagina come anteprima nella scheda del
 * documento, e produrre un'immagine su cui far girare l'OCR (Tesseract legge
 * pixel, non PDF).
 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'

const BASE = import.meta.env.BASE_URL || '/'
const asset = (p: string) => `${BASE.replace(/\/$/, '')}/${p}`

// Il worker di pdf.js viene dal nostro dominio: nessuna CDN coinvolta.
GlobalWorkerOptions.workerSrc = asset('pdf/pdf.worker.min.mjs')

/**
 * Dati dei font standard e tabelle cMap, serviti da `public/pdf/`.
 *
 * Non sono opzionali: un PDF che usa Helvetica o Times senza incorporarli — cioè
 * la maggior parte dei PDF prodotti da software da ufficio — fa attendere pdf.js
 * su questi file. Se l'URL non è impostato, `render()` non si risolve mai e
 * l'anteprima resta a caricare per sempre.
 */
const STANDARD_FONT_DATA_URL = asset('pdf/standard_fonts/')
const CMAP_URL = asset('pdf/cmaps/')

export interface RenderedPage {
  canvas: HTMLCanvasElement
  pageCount: number
}

/** Renderizza una pagina del PDF a una larghezza target in pixel. */
export async function renderPdfPage(
  file: Blob,
  pageNumber = 1,
  targetWidth = 1400,
): Promise<RenderedPage> {
  const data = new Uint8Array(await file.arrayBuffer())
  let pdf: PDFDocumentProxy | null = null
  try {
    pdf = await getDocument({
      data,
      // `isEvalSupported: false` evita che pdf.js compili funzioni a runtime.
      isEvalSupported: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
    }).promise
    const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages))
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(3, Math.max(0.5, targetWidth / baseViewport.width))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas non disponibile.')
    // Sfondo bianco: i PDF trasparenti diventerebbero neri su tema scuro.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // `intent: 'print'` non è un dettaglio estetico: con l'intento predefinito
    // pdf.js scandisce il disegno con requestAnimationFrame, che non scatta
    // quando la pagina non è visibile (scheda in background, PWA minimizzata,
    // Safari che limita le animazioni). In quel caso `render()` non si
    // risolverebbe mai e l'importazione di un PDF resterebbe a caricare per
    // sempre. Qui disegniamo su un canvas fuori schermo, quindi la
    // sincronizzazione col refresh non serve.
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise

    return { canvas, pageCount: pdf.numPages }
  } finally {
    await pdf?.destroy()
  }
}

/** Prima pagina come PNG, da usare per anteprima e OCR. */
export async function pdfFirstPageToBlob(file: Blob): Promise<{ blob: Blob; pageCount: number }> {
  const { canvas, pageCount } = await renderPdfPage(file, 1)
  const blob = await canvasToBlob(canvas, 'image/png')
  return { blob, pageCount }
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Conversione immagine non riuscita.'))),
      mime,
      quality,
    )
  })
}

export function isPdf(file: Blob | { type: string }): boolean {
  return file.type === 'application/pdf'
}
