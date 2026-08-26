/**
 * Generatore delle icone PWA — nessuna dipendenza esterna.
 *
 * Il marchio: uno scudo con dentro, in negativo, una tessera (foto + righe
 * dati). Non è uno scudo generico e non è un lucchetto: dice "documenti
 * protetti", che è esattamente cosa fa l'app.
 *
 * Cura tipica del mestiere, tutta qui dentro:
 *  - gradiente verticale sullo sfondo, più un alone diagonale in alto a sinistra
 *    che simula una luce d'ambiente;
 *  - bordo superiore dello scudo schiarito (il "vetro" che prende luce) e base
 *    leggermente scurita;
 *  - ombra morbida sotto lo scudo, per staccarlo dallo sfondo;
 *  - la tessera in negativo usa il colore dello sfondo, non nero: sembra un
 *    foro, non una macchia;
 *  - alle dimensioni piccole la tessera sparisce e resta il buco della chiave:
 *    a 32px tre righe dati diventerebbero fango.
 *
 * Antialiasing con supersampling 4×4.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SS = 4

/* ------------------------------- palette ------------------------------- */

const BG_TOP = [21, 28, 48]
const BG_BOTTOM = [7, 10, 19]
const SHEEN = [122, 162, 255]
const ACCENT_TOP = [138, 174, 255]
const ACCENT_BOTTOM = [134, 92, 246]
const KNOCKOUT = [12, 16, 30]

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (a, b, t) => {
  const k = clamp01(t)
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
const lighten = (c, t) => mix(c, [255, 255, 255], t)
const darken = (c, t) => mix(c, [0, 0, 0], t)

/* ------------------------------ primitive ------------------------------ */

/** Rettangolo arrotondato centrato, in coordinate arbitrarie. */
function inRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r)
  const dy = Math.abs(y - cy) - (hh - r)
  if (dx <= 0 || dy <= 0) return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh
  return dx * dx + dy * dy <= r * r
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * Sagoma dello scudo in coordinate normalizzate: u ∈ [-1,1], v ∈ [-1,1].
 * Spalle con angoli arrotondati, punta con rastremazione morbida.
 * `grow` allarga la sagoma: serve per il bordo e per l'ombra.
 */
function inShield(u, v, grow = 0) {
  const g = grow
  if (v < -1 - g || v > 1 + g) return false
  const shoulderEnd = 0.12
  if (v <= shoulderEnd) {
    const r = 0.24
    const au = Math.abs(u)
    const limit = 1 + g
    if (au > limit) return false
    if (v < -1 + r && au > limit - r) {
      const dx = au - (limit - r)
      const dy = -1 + r - v
      return dx * dx + dy * dy <= r * r
    }
    return true
  }
  const t = (v - shoulderEnd) / (1 + g - shoulderEnd)
  if (t > 1) return false
  // Esponente 1.6: punta piena a metà altezza, affilata solo in fondo.
  const halfWidth = (1 + g) * (1 - Math.pow(t, 1.6))
  return Math.abs(u) <= halfWidth
}

/*
 * I motivi interni sono definiti in unità di semialtezza dello scudo, con la
 * coordinata orizzontale già compensata dall'aspetto (`mu = u * halfW / halfH`).
 * Senza questa compensazione un cerchio disegnato nello spazio dello scudo
 * uscirebbe ovale: è l'errore che tradisce un'icona costruita a occhio.
 */

/** Tessera in negativo: foto tonda più tre righe dati. */
function inCard(mu, mv) {
  if (inCircle(mu, mv, -0.3, -0.2, 0.185)) return true
  if (inRoundRect(mu, mv, 0.2, -0.28, 0.28, 0.055, 0.055)) return true
  if (inRoundRect(mu, mv, 0.12, -0.11, 0.2, 0.055, 0.055)) return true
  if (inRoundRect(mu, mv, -0.05, 0.15, 0.36, 0.055, 0.055)) return true
  return false
}

/** Buco della chiave, per le dimensioni piccole. */
function inKeyhole(mu, mv) {
  if (inCircle(mu, mv, 0, -0.14, 0.24)) return true
  if (mv > -0.14 && mv < 0.42) {
    const t = (mv + 0.14) / 0.56
    return Math.abs(mu) <= 0.09 + 0.08 * t
  }
  return false
}

/* ------------------------------ rendering ------------------------------ */

function renderIcon(size, { padding, motif }) {
  const px = new Uint8Array(size * size * 4)
  const inner = 1 - padding
  // Semiassi dello scudo in frazione di lato: 0.42 × 0.46 dà la proporzione
  // corretta di uno scudo araldico (più alto che largo).
  const halfW = inner * 0.355
  const halfH = inner * 0.415
  const bgRadius = 0.235 // frazione del lato: raggio dello sfondo arrotondato
  const shadowOffset = inner * 0.022

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size
          const fy = (y + (sy + 0.5) / SS) / size

          // Fuori dallo sfondo arrotondato il pixel è trasparente: le icone
          // "any" restano una piastrella pulita anche senza maschera del sistema.
          const insideBg = inRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, bgRadius)
          if (!insideBg) continue

          // Sfondo: gradiente verticale più alone diagonale.
          let color = mix(BG_TOP, BG_BOTTOM, fy)
          const sheen = Math.max(0, 1 - Math.hypot(fx - 0.22, fy - 0.1) * 1.55)
          color = mix(color, SHEEN, sheen * 0.13)

          const u = (fx - 0.5) / halfW
          const v = (fy - 0.5) / halfH

          // Ombra sotto lo scudo: la stessa sagoma, traslata e sfumata.
          const vs = (fy - 0.5 - shadowOffset) / halfH
          if (inShield(u, vs, 0.06) && !inShield(u, v)) {
            color = darken(color, 0.4)
          }

          if (inShield(u, v)) {
            const shieldT = (v + 1) / 2
            let shield = mix(ACCENT_TOP, ACCENT_BOTTOM, shieldT)
            // Luce sul bordo superiore, ombra verso la punta.
            if (!inShield(u, v, -0.045)) {
              shield = v < 0.3 ? lighten(shield, 0.3) : darken(shield, 0.12)
            }
            shield = mix(shield, darken(shield, 0.18), Math.max(0, (v - 0.45) / 0.55) * 0.6)

            const mu = u * (halfW / halfH)
            const knocked = motif === 'card' ? inCard(mu, v) : inKeyhole(mu, v)
            color = knocked ? mix(KNOCKOUT, BG_TOP, 0.25) : shield
          }

          r += color[0]
          g += color[1]
          b += color[2]
          a += 255
        }
      }

      const n = SS * SS
      const o = (y * size + x) * 4
      // Colore premoltiplicato dalla copertura: evita l'alone scuro sui bordi.
      const cov = a / (n * 255)
      px[o] = Math.round(cov > 0 ? r / (n * cov) : 0)
      px[o + 1] = Math.round(cov > 0 ? g / (n * cov) : 0)
      px[o + 2] = Math.round(cov > 0 ? b / (n * cov) : 0)
      px[o + 3] = Math.round(a / n)
    }
  }
  return px
}

/* -------------------------------- PNG --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // profondità
  ihdr[9] = 6 // RGBA
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // nessun filtro
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * stride + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* -------------------------------- output ------------------------------- */

mkdirSync(OUT, { recursive: true })

const TARGETS = [
  // nome, lato, margine, motivo interno
  ['icon-192.png', 192, 0.11, 'card'],
  ['icon-512.png', 512, 0.11, 'card'],
  // L'icona mascherabile ha il margine largo che Android richiede (safe zone).
  ['icon-maskable.png', 512, 0.32, 'card'],
  ['apple-touch-icon.png', 180, 0.1, 'card'],
  ['favicon-32.png', 32, 0.06, 'keyhole'],
]

for (const [name, size, padding, motif] of TARGETS) {
  writeFileSync(resolve(OUT, name), encodePNG(size, renderIcon(size, { padding, motif })))
  console.log(`  ✓ icons/${name}  ${size}×${size}  (${motif})`)
}
