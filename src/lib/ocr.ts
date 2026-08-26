/**
 * OCR interamente lato client con Tesseract.js.
 *
 * Nessuna richiesta di rete verso l'esterno: worker, core WebAssembly e modello
 * linguistico italiano sono serviti dalla cartella `public/` della stessa app
 * (vedi `scripts/prepare-ocr-assets.mjs`). Il service worker li mette in cache,
 * quindi l'OCR funziona anche offline.
 *
 * Sono previste due passate:
 *   1. pagina intera, per etichette e campi in chiaro;
 *   2. solo la fascia inferiore con alfabeto ristretto, per leggere la MRZ senza
 *      che Tesseract "corregga" i caratteri `<` in lettere.
 */
import { createWorker, type Worker } from 'tesseract.js'
import { loadOrientedBitmap } from './scan'

const BASE = import.meta.env.BASE_URL || '/'
const asset = (p: string) => `${BASE.replace(/\/$/, '')}/${p}`

export interface OcrProgress {
  /** 0..1 */
  progress: number
  /** Etichetta leggibile dello stadio corrente. */
  label: string
}

export interface OcrResult {
  /** Testo della passata a pagina intera. */
  text: string
  /** Testo della passata dedicata alla MRZ, se eseguita. */
  mrzText?: string
  /** Confidenza media riportata da Tesseract, 0..100. */
  confidence: number
}

const STAGE_LABELS: Record<string, string> = {
  'loading tesseract core': 'Avvio del motore OCR',
  'initializing tesseract': 'Inizializzazione',
  'loading language traineddata': 'Caricamento modello italiano',
  'initializing api': 'Preparazione',
  'recognizing text': 'Lettura del documento',
}

let workerPromise: Promise<Worker> | null = null
let progressSink: ((p: OcrProgress) => void) | null = null

/**
 * Il worker è unico e resta caldo tra un documento e l'altro: la
 * reinizializzazione costerebbe alcuni secondi per ogni scansione.
 */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('ita', 1, {
      workerPath: asset('tesseract/worker.min.js'),
      corePath: asset('tesseract/core'),
      langPath: asset('tessdata'),
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        progressSink?.({
          progress: m.progress,
          label: STAGE_LABELS[m.status] ?? 'Elaborazione',
        })
      },
      errorHandler: (err: unknown) => console.error('[ocr]', err),
    }).catch((err) => {
      // Un fallimento di caricamento non deve bloccare per sempre l'OCR.
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/** Libera il worker: chiamata al blocco del caveau per non tenere memoria occupata. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return
  const current = workerPromise
  workerPromise = null
  try {
    ;(await current).terminate()
  } catch {
    /* già terminato */
  }
}

export function isOcrSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function'
}

/* -------------------------- pre-elaborazione immagine ------------------------- */

const MAX_SIDE = 1800

/**
 * Porta l'immagine a una dimensione utile, la converte in scala di grigi e ne
 * allarga l'istogramma. Su una foto scattata col telefono questo cambia la
 * qualità del riconoscimento più di qualsiasi parametro di Tesseract.
 */
export async function preprocess(source: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await blobToBitmap(source)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas non disponibile su questo browser.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if ('close' in bitmap) (bitmap as ImageBitmap).close()

  const image = ctx.getImageData(0, 0, width, height)
  const px = image.data

  // Luminanza percettiva, poi percentili 2/98 per ignorare riflessi e ombre.
  const gray = new Uint8ClampedArray(width * height)
  const histogram = new Uint32Array(256)
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const value = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
    gray[g] = value
    histogram[value]++
  }
  const total = gray.length
  let low = 0
  let high = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]
    if (acc > total * 0.02) {
      low = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += histogram[v]
    if (acc > total * 0.02) {
      high = v
      break
    }
  }
  const span = Math.max(1, high - low)

  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const stretched = Math.max(0, Math.min(255, ((gray[g] - low) * 255) / span))
    px[i] = px[i + 1] = px[i + 2] = stretched
    px[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/*
 * L'orientamento EXIF passa dal caricatore condiviso in `scan.ts`: una foto
 * ruotata letta come pixel grezzi verrebbe passata a Tesseract di traverso, e
 * il riconoscimento del testo fallirebbe quasi del tutto.
 */
async function blobToBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await loadOrientedBitmap(blob)
  } catch {
    /* si prosegue col ripiego locale */
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Immagine non leggibile.'))
      img.src = url
    })
    return img
  } finally {
    // L'URL può essere revocato subito: <img> ha già decodificato.
    URL.revokeObjectURL(url)
  }
}

/** Ritaglia la fascia inferiore, dove si trova la MRZ. */
function cropBottomBand(canvas: HTMLCanvasElement, fraction = 0.34): HTMLCanvasElement {
  const height = Math.max(48, Math.round(canvas.height * fraction))
  const band = document.createElement('canvas')
  band.width = canvas.width
  band.height = height
  const ctx = band.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(canvas, 0, canvas.height - height, canvas.width, height, 0, 0, canvas.width, height)
  return band
}

const MRZ_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

/* ---------------------------------- API ---------------------------------- */

/**
 * Riconosce il testo di una faccia del documento.
 * `mrzPass` va attivato per il retro di CIE e per la pagina dati del passaporto.
 */
export async function recognize(
  image: Blob,
  options: { mrzPass?: boolean; onProgress?: (p: OcrProgress) => void } = {},
): Promise<OcrResult> {
  if (!isOcrSupported()) throw new Error('OCR non supportato da questo browser.')
  progressSink = options.onProgress ?? null
  try {
    const worker = await getWorker()
    const canvas = await preprocess(image)

    await worker.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1' })
    const full = await worker.recognize(canvas)

    let mrzText: string | undefined
    if (options.mrzPass) {
      options.onProgress?.({ progress: 0.85, label: 'Lettura banda MRZ' })
      const band = cropBottomBand(canvas)
      await worker.setParameters({
        tessedit_char_whitelist: MRZ_CHARSET,
        preserve_interword_spaces: '0',
      })
      const mrz = await worker.recognize(band)
      mrzText = mrz.data.text
      await worker.setParameters({ tessedit_char_whitelist: '' })
    }

    options.onProgress?.({ progress: 1, label: 'Completato' })
    return {
      text: full.data.text,
      mrzText,
      confidence: full.data.confidence ?? 0,
    }
  } finally {
    progressSink = null
  }
}
