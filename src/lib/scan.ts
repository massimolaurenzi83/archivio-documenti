/**
 * Rilevamento del bordo del documento e raddrizzamento prospettico.
 *
 * Perché serve: una foto scattata a mano libera è sempre inclinata e contiene
 * il tavolo intorno. Tesseract su un'immagine così perde righe intere, e la
 * banda MRZ — la fonte di dati più affidabile che abbiamo — è la prima a
 * saltare, perché il suo riconoscimento presuppone righe orizzontali.
 *
 * Come funziona, in ordine:
 *   1. l'immagine viene ridotta a ~480px per lato lungo (il rilevamento non ha
 *      bisogno di risoluzione, e su 12 megapixel costerebbe secondi);
 *   2. scala di grigi, sfocatura gaussiana 3×3, gradiente di Sobel;
 *   3. trasformata di Hough sui pixel di bordo: ogni retta candidata riceve voti;
 *   4. tra le rette si scelgono le due più votate quasi-orizzontali e le due
 *      quasi-verticali che siano anche ben distanziate — sono i quattro lati;
 *   5. le intersezioni danno i quattro angoli, che vengono validati;
 *   6. un'omografia riporta il quadrilatero a un rettangolo, con
 *      campionamento bilineare.
 *
 * Tutto in JavaScript puro: nessuna libreria di visione artificiale, nessuna
 * richiesta di rete. Se il rilevamento non trova un quadrilatero plausibile
 * restituisce `null` e l'immagine resta intera, come prima.
 */

export interface Point {
  x: number
  y: number
}

/** Angoli in senso orario a partire da quello in alto a sinistra. */
export type Quad = [Point, Point, Point, Point]

/** Lato lungo usato per il rilevamento: oltre non migliora, costa solo tempo. */
const DETECT_SIZE = 480
/** Passo angolare della trasformata di Hough, in gradi. */
const THETA_STEP = 1
/** Quanto una retta può discostarsi da orizzontale/verticale per essere un lato. */
const ANGLE_TOLERANCE = 32
/**
 * Frazione minima del fotogramma occupata dal documento.
 *
 * Tenerla alta sembra prudente e invece disattiva la funzione: fotografando una
 * tessera a distanza comoda questa occupa il 10-15% dell'inquadratura, non il
 * 20-30%. La precisione si difende con la verifica del contrasto lungo i bordi,
 * non stringendo questa soglia.
 */
const MIN_AREA_RATIO = 0.05

/* ------------------------------ pre-elaborazione ----------------------------- */

interface Gray {
  data: Float32Array
  width: number
  height: number
}

function toGray(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas non disponibile.')
  const { width, height } = canvas
  const px = ctx.getImageData(0, 0, width, height).data
  const data = new Float32Array(width * height)
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    data[g] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
  }
  return { data, width, height }
}

/** Sfocatura gaussiana 3×3 separabile: attenua il rumore del sensore. */
function blur(src: Gray): Gray {
  const { width, height, data } = src
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  // Orizzontale, kernel [1 2 1] / 4.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const l = x > 0 ? data[i - 1] : data[i]
      const r = x < width - 1 ? data[i + 1] : data[i]
      tmp[i] = (l + 2 * data[i] + r) * 0.25
    }
  }
  // Verticale.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const u = y > 0 ? tmp[i - width] : tmp[i]
      const d = y < height - 1 ? tmp[i + width] : tmp[i]
      out[i] = (u + 2 * tmp[i] + d) * 0.25
    }
  }
  return { data: out, width, height }
}

interface Edges {
  magnitude: Float32Array
  width: number
  height: number
  threshold: number
}

/** Gradiente di Sobel, con soglia sul 92° percentile della magnitudine. */
function sobel(src: Gray): Edges {
  const { width, height, data } = src
  const magnitude = new Float32Array(width * height)
  let max = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const tl = data[i - width - 1]
      const t = data[i - width]
      const tr = data[i - width + 1]
      const l = data[i - 1]
      const r = data[i + 1]
      const bl = data[i + width - 1]
      const b = data[i + width]
      const br = data[i + width + 1]
      const gx = tr + 2 * r + br - (tl + 2 * l + bl)
      const gy = bl + 2 * b + br - (tl + 2 * t + tr)
      const m = Math.hypot(gx, gy)
      magnitude[i] = m
      if (m > max) max = m
    }
  }

  // Soglia per percentile: robusta sia su foto piatte sia molto contrastate.
  const bins = 256
  const histogram = new Uint32Array(bins)
  const scale = max > 0 ? (bins - 1) / max : 0
  for (let i = 0; i < magnitude.length; i++) histogram[(magnitude[i] * scale) | 0]++
  const target = magnitude.length * 0.08 // teniamo l'8% dei pixel più marcati
  let kept = 0
  let threshold = max
  for (let bin = bins - 1; bin >= 0; bin--) {
    kept += histogram[bin]
    if (kept >= target) {
      threshold = bin / scale
      break
    }
  }
  return { magnitude, width, height, threshold: Math.max(threshold, max * 0.12) }
}

/* -------------------------------- Hough -------------------------------- */

interface Line {
  /** Distanza dall'origine, in pixel dell'immagine ridotta. */
  rho: number
  /** Angolo in radianti: 0 = retta verticale, π/2 = retta orizzontale. */
  theta: number
  votes: number
}

function houghLines(edges: Edges): Line[] {
  const { magnitude, width, height, threshold } = edges
  const thetaCount = Math.round(180 / THETA_STEP)
  const diagonal = Math.ceil(Math.hypot(width, height))
  const rhoCount = diagonal * 2 + 1
  const accumulator = new Uint32Array(thetaCount * rhoCount)

  const cos = new Float32Array(thetaCount)
  const sin = new Float32Array(thetaCount)
  for (let t = 0; t < thetaCount; t++) {
    const angle = (t * THETA_STEP * Math.PI) / 180
    cos[t] = Math.cos(angle)
    sin[t] = Math.sin(angle)
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (magnitude[y * width + x] < threshold) continue
      for (let t = 0; t < thetaCount; t++) {
        const rho = Math.round(x * cos[t] + y * sin[t]) + diagonal
        accumulator[t * rhoCount + rho]++
      }
    }
  }

  // Soppressione dei non-massimi: senza, un unico bordo produce venti rette
  // quasi identiche e la scelta dei lati diventa casuale.
  const lines: Line[] = []
  const rhoWindow = Math.max(6, Math.round(diagonal * 0.03))
  const thetaWindow = 4
  const minVotes = Math.max(24, Math.round(Math.min(width, height) * 0.18))

  for (let t = 0; t < thetaCount; t++) {
    for (let r = 0; r < rhoCount; r++) {
      const votes = accumulator[t * rhoCount + r]
      if (votes < minVotes) continue
      let isPeak = true
      for (let dt = -thetaWindow; dt <= thetaWindow && isPeak; dt++) {
        const tt = (t + dt + thetaCount) % thetaCount
        for (let dr = -rhoWindow; dr <= rhoWindow; dr++) {
          const rr = r + dr
          if (rr < 0 || rr >= rhoCount) continue
          if (accumulator[tt * rhoCount + rr] > votes) {
            isPeak = false
            break
          }
        }
      }
      if (isPeak) {
        lines.push({
          rho: r - diagonal,
          theta: (t * THETA_STEP * Math.PI) / 180,
          votes,
        })
      }
    }
  }

  return lines.sort((a, b) => b.votes - a.votes).slice(0, 60)
}

/** Coordinata della retta al centro dell'immagine: misura la sua posizione. */
function centerOffset(line: Line, width: number, height: number, horizontal: boolean): number {
  const c = Math.cos(line.theta)
  const s = Math.sin(line.theta)
  return horizontal
    ? (line.rho - (width / 2) * c) / (Math.abs(s) < 1e-6 ? 1e-6 : s) // y al centro
    : (line.rho - (height / 2) * s) / (Math.abs(c) < 1e-6 ? 1e-6 : c) // x al centro
}

/**
 * Scelta della coppia di lati opposti: massimizza i voti, ma solo tra rette
 * separate almeno del 35% della dimensione. Senza il vincolo di distanza si
 * finisce per prendere due volte lo stesso bordo del documento.
 */
function bestPair(
  candidates: Line[],
  width: number,
  height: number,
  horizontal: boolean,
): [Line, Line] | null {
  const span = horizontal ? height : width
  // Basta che i due lati opposti non siano lo stesso bordo: pretendere un terzo
  // dell'inquadratura escludeva ogni documento non a tutto schermo.
  const minSeparation = span * 0.12
  let best: [Line, Line] | null = null
  let bestScore = -1

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      const separation = Math.abs(
        centerOffset(a, width, height, horizontal) - centerOffset(b, width, height, horizontal),
      )
      if (separation < minSeparation) continue
      // I lati opposti di un documento sono quasi paralleli.
      const angleDelta = Math.abs(a.theta - b.theta)
      if (Math.min(angleDelta, Math.PI - angleDelta) > (18 * Math.PI) / 180) continue
      const score = a.votes + b.votes
      if (score > bestScore) {
        bestScore = score
        best =
          centerOffset(a, width, height, horizontal) < centerOffset(b, width, height, horizontal)
            ? [a, b]
            : [b, a]
      }
    }
  }
  return best
}

function intersect(a: Line, b: Line): Point | null {
  const ca = Math.cos(a.theta)
  const sa = Math.sin(a.theta)
  const cb = Math.cos(b.theta)
  const sb = Math.sin(b.theta)
  const det = ca * sb - sa * cb
  if (Math.abs(det) < 1e-6) return null // rette parallele
  return {
    x: (a.rho * sb - b.rho * sa) / det,
    y: (b.rho * ca - a.rho * cb) / det,
  }
}

/* ------------------------------- validazione ------------------------------ */

function polygonArea(quad: Quad): number {
  let area = 0
  for (let i = 0; i < 4; i++) {
    const p = quad[i]
    const q = quad[(i + 1) % 4]
    area += p.x * q.y - q.x * p.y
  }
  return Math.abs(area) / 2
}

function isConvex(quad: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const c = quad[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-6) continue
    const current = Math.sign(cross)
    if (sign === 0) sign = current
    else if (current !== sign) return false
  }
  return sign !== 0
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/* ---------------------------------- API ---------------------------------- */

export interface DetectionResult {
  /** Angoli in coordinate dell'immagine originale. */
  quad: Quad
  /** Quanto il documento è inclinato, in gradi: utile per decidere se valga la pena. */
  skewDegrees: number
  /** Frazione dell'immagine occupata dal documento. */
  coverage: number
}

/**
 * Cerca il documento nell'immagine. `null` se non trova un quadrilatero
 * plausibile: in quel caso l'immagine va usata così com'è.
 */
export function detectDocument(source: HTMLCanvasElement): DetectionResult | null {
  const scale = Math.min(1, DETECT_SIZE / Math.max(source.width, source.height))
  const width = Math.max(32, Math.round(source.width * scale))
  const height = Math.max(32, Math.round(source.height * scale))

  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, width, height)

  const gray = blur(toGray(small))
  const edges = sobel(gray)
  const lines = houghLines(edges)
  if (lines.length < 4) return null

  const tolerance = (ANGLE_TOLERANCE * Math.PI) / 180
  const horizontal = lines.filter((l) => Math.abs(l.theta - Math.PI / 2) <= tolerance)
  const vertical = lines.filter(
    (l) => l.theta <= tolerance || l.theta >= Math.PI - tolerance,
  )

  const pairH = bestPair(horizontal, width, height, true)
  const pairV = bestPair(vertical, width, height, false)
  if (!pairH || !pairV) return null

  const [top, bottom] = pairH
  const [left, right] = pairV

  const corners = [
    intersect(top, left),
    intersect(top, right),
    intersect(bottom, right),
    intersect(bottom, left),
  ]
  if (corners.some((c) => c === null)) return null

  // Un po' di sconfinamento è normale (il documento tocca il bordo dello
  // scatto); molto significa che le rette trovate non erano i suoi lati.
  const slack = 0.08
  const quadSmall = corners as Quad
  for (const c of quadSmall) {
    if (
      c.x < -width * slack ||
      c.x > width * (1 + slack) ||
      c.y < -height * slack ||
      c.y > height * (1 + slack)
    ) {
      return null
    }
  }

  if (!isConvex(quadSmall)) return null

  const area = polygonArea(quadSmall)
  const coverage = area / (width * height)
  if (coverage < MIN_AREA_RATIO || coverage > 1.02) return null

  const diagonal = Math.hypot(width, height)
  for (let i = 0; i < 4; i++) {
    if (distance(quadSmall[i], quadSmall[(i + 1) % 4]) < diagonal * 0.06) return null
  }

  // Un documento ha proporzioni ragionevoli: scarta strisce e schegge.
  const latoA = distance(quadSmall[0], quadSmall[1])
  const latoB = distance(quadSmall[1], quadSmall[2])
  const proporzione = Math.max(latoA, latoB) / Math.max(1, Math.min(latoA, latoB))
  if (proporzione > 3.2) return null

  // Verifica decisiva: lungo il bordo il quadrilatero deve separare due zone di
  // luminosità diversa. È ciò che distingue il contorno di un documento da
  // quattro rette qualunque trovate nelle venature del tavolo, e permette di
  // tenere le soglie qui sopra larghe senza inventare rilevamenti.
  if (!hasBorderContrast(gray, quadSmall)) return null

  // Inclinazione del lato superiore rispetto all'orizzontale.
  const topEdge = { x: quadSmall[1].x - quadSmall[0].x, y: quadSmall[1].y - quadSmall[0].y }
  const skewDegrees = (Math.atan2(topEdge.y, topEdge.x) * 180) / Math.PI

  // Ritorno alle coordinate dell'immagine piena.
  const quad = quadSmall.map((p) => ({
    x: clamp(p.x / scale, 0, source.width),
    y: clamp(p.y / scale, 0, source.height),
  })) as Quad

  return { quad, skewDegrees, coverage }
}

/**
 * Confronta la luminosità appena dentro e appena fuori ogni lato.
 *
 * Campiona punti lungo il perimetro e guarda 4 pixel verso l'interno e 4 verso
 * l'esterno lungo la normale. Se almeno tre lati su quattro mostrano un salto
 * netto, il quadrilatero poggia su un bordo vero.
 */
function hasBorderContrast(gray: Gray, quad: Quad): boolean {
  const { data, width, height } = gray
  const at = (x: number, y: number): number | null => {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return null
    return data[py * width + px]
  }

  const centro = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  }
  const OFFSET = 4
  const CAMPIONI = 12
  const SALTO_MINIMO = 10

  let latiConvincenti = 0
  for (let lato = 0; lato < 4; lato++) {
    const a = quad[lato]
    const b = quad[(lato + 1) % 4]
    const lunghezza = Math.hypot(b.x - a.x, b.y - a.y)
    if (lunghezza < 1) continue
    // Normale al lato, orientata verso l'esterno.
    let nx = -(b.y - a.y) / lunghezza
    let ny = (b.x - a.x) / lunghezza
    const medio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if ((medio.x + nx - centro.x) ** 2 + (medio.y + ny - centro.y) ** 2 <
        (medio.x - centro.x) ** 2 + (medio.y - centro.y) ** 2) {
      nx = -nx
      ny = -ny
    }

    let dentro = 0
    let fuori = 0
    let validi = 0
    for (let i = 1; i <= CAMPIONI; i++) {
      const t = i / (CAMPIONI + 1)
      const px = a.x + (b.x - a.x) * t
      const py = a.y + (b.y - a.y) * t
      const d = at(px - nx * OFFSET, py - ny * OFFSET)
      const f = at(px + nx * OFFSET, py + ny * OFFSET)
      if (d === null || f === null) continue
      dentro += d
      fuori += f
      validi++
    }
    if (validi >= CAMPIONI / 2 && Math.abs(dentro / validi - fuori / validi) >= SALTO_MINIMO) {
      latiConvincenti++
    }
  }
  return latiConvincenti >= 3
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/* ------------------------------- omografia ------------------------------- */

/**
 * Omografia che porta il rettangolo di destinazione sul quadrilatero di
 * origine: serve la mappa *inversa*, perché il warp scandisce i pixel di
 * destinazione e va a leggere quelli di partenza.
 *
 * Sistema lineare 8×8 risolto con eliminazione di Gauss e pivot parziale.
 */
function homography(dest: Quad, src: Quad): number[] | null {
  const m: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = dest[i]
    const { x: u, y: v } = src[i]
    m.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u])
    m.push([0, 0, 0, x, y, 1, -x * v, -y * v, v])
  }

  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-10) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]

    const divisor = m[col][col]
    for (let k = col; k <= 8; k++) m[col][k] /= divisor

    for (let row = 0; row < 8; row++) {
      if (row === col) continue
      const factor = m[row][col]
      if (factor === 0) continue
      for (let k = col; k <= 8; k++) m[row][k] -= factor * m[col][k]
    }
  }

  return m.map((row) => row[8])
}

/** Lato lungo massimo dell'immagine raddrizzata. */
const MAX_OUTPUT_SIDE = 1800

/**
 * Raddrizza il quadrilatero in un rettangolo.
 *
 * Le proporzioni non vengono forzate a quelle di una carta ID-1: si misurano
 * dai lati rilevati. Forzare 1,586 raddrizzerebbe bene una carta d'identità e
 * schiaccerebbe un foglio A4, e questa app archivia anche fogli A4.
 */
export function warpDocument(source: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  const widthTop = distance(quad[0], quad[1])
  const widthBottom = distance(quad[3], quad[2])
  const heightLeft = distance(quad[0], quad[3])
  const heightRight = distance(quad[1], quad[2])

  let outWidth = Math.round(Math.max(widthTop, widthBottom))
  let outHeight = Math.round(Math.max(heightLeft, heightRight))
  const shrink = Math.min(1, MAX_OUTPUT_SIDE / Math.max(outWidth, outHeight))
  outWidth = Math.max(64, Math.round(outWidth * shrink))
  outHeight = Math.max(64, Math.round(outHeight * shrink))

  const destQuad: Quad = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ]
  const h = homography(destQuad, quad)
  if (!h) return source

  const srcCtx = source.getContext('2d', { willReadFrequently: true })
  if (!srcCtx) return source
  const srcImage = srcCtx.getImageData(0, 0, source.width, source.height)
  const srcData = srcImage.data
  const sw = source.width
  const sh = source.height

  const out = document.createElement('canvas')
  out.width = outWidth
  out.height = outHeight
  const outCtx = out.getContext('2d')
  if (!outCtx) return source
  const outImage = outCtx.createImageData(outWidth, outHeight)
  const outData = outImage.data

  const [h0, h1, h2, h3, h4, h5, h6, h7] = h

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const denominator = h6 * x + h7 * y + 1
      const sx = (h0 * x + h1 * y + h2) / denominator
      const sy = (h3 * x + h4 * y + h5) / denominator
      const o = (y * outWidth + x) * 4

      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        // Fuori dall'originale: bianco, non nero. Un bordo nero verrebbe letto
        // dall'OCR come inchiostro.
        outData[o] = outData[o + 1] = outData[o + 2] = 255
        outData[o + 3] = 255
        continue
      }

      // Campionamento bilineare: senza, il testo raddrizzato si sgrana.
      const x0 = sx | 0
      const y0 = sy | 0
      const x1 = Math.min(x0 + 1, sw - 1)
      const y1 = Math.min(y0 + 1, sh - 1)
      const fx = sx - x0
      const fy = sy - y0
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4

      for (let channel = 0; channel < 3; channel++) {
        outData[o + channel] =
          srcData[i00 + channel] * w00 +
          srcData[i10 + channel] * w10 +
          srcData[i01 + channel] * w01 +
          srcData[i11 + channel] * w11
      }
      outData[o + 3] = 255
    }
  }

  outCtx.putImageData(outImage, 0, 0)
  return out
}

/**
 * Carica un'immagine applicando l'orientamento EXIF.
 *
 * Non è un dettaglio: una foto scattata col telefono porta quasi sempre un tag
 * di orientamento, e i due modi di leggerla si comportano in modo opposto. Un
 * `<img>` applica sempre la rotazione; `createImageBitmap` senza opzioni può
 * restituire i pixel grezzi. Se l'anteprima mostrata è ruotata e il canvas su
 * cui si lavora no, l'utente trascina gli angoli su un'immagine e il ritaglio
 * avviene su un'altra: il risultato inquadra il tavolo invece del documento, e
 * l'OCR legge il testo di traverso.
 *
 * Chiedere `from-image` esplicitamente allinea i due mondi.
 */
export async function loadOrientedBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      // Browser che non conoscono l'opzione: meglio senza che niente.
      try {
        return await createImageBitmap(blob)
      } catch {
        /* si prosegue col ripiego su <img> */
      }
    }
  }
  return loadViaImageElement(blob)
}

/** Carica un blob in un canvas alla risoluzione nativa, già orientato. */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await loadOrientedBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas non disponibile.')
  ctx.drawImage(bitmap, 0, 0)
  if ('close' in bitmap) bitmap.close()
  return canvas
}

/**
 * Ripiego per i browser senza `createImageBitmap`: un `<img>` applica da sé
 * l'orientamento EXIF, e `drawImage` disegna l'immagine già ruotata.
 */
async function loadViaImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Immagine non leggibile.'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
