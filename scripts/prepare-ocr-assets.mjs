/**
 * Aggiorna gli asset dell'OCR e del rendering PDF dentro `public/`.
 *
 * Gli asset sono committati nel repository di proposito: se venissero scaricati
 * da una CDN al primo uso, quella CDN saprebbe *quando* l'utente sta
 * scansionando un documento. Meglio 16 MB nel repo che una richiesta di rete in
 * un'app che promette di non farne.
 *
 * Il worker e i core WebAssembly si copiano da node_modules; il modello
 * linguistico italiano si scarica da tessdata (serve rete solo per questo).
 *
 *   node scripts/prepare-ocr-assets.mjs
 */
import { copyFileSync, cpSync, mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'public')

/** Versione "fast" del modello: 1,3 MB contro 12, con perdita trascurabile sui documenti. */
const TESSDATA_URL =
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/ita.traineddata.gz'

const COPIES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // Varianti SIMD e non-SIMD: tesseract.js sceglie in base al dispositivo.
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract/core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract/core/tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf/pdf.worker.min.mjs'],
]

/*
 * Cartelle richieste da pdf.js: senza di queste, un PDF che usa un font
 * standard non incorporato (Helvetica, Times: la maggioranza dei PDF generati
 * da software da ufficio) resta in attesa per sempre invece di renderizzare.
 */
const TREES = [
  ['node_modules/pdfjs-dist/standard_fonts', 'pdf/standard_fonts'],
  ['node_modules/pdfjs-dist/cmaps', 'pdf/cmaps'],
]

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`

for (const [from, to] of COPIES) {
  const source = resolve(ROOT, from)
  if (!existsSync(source)) {
    console.error(`  ✗ manca ${from} — esegui prima "npm install"`)
    process.exitCode = 1
    continue
  }
  const target = resolve(PUBLIC, to)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log(`  ✓ ${to}  (${kb(statSync(target).size)})`)
}

for (const [from, to] of TREES) {
  const source = resolve(ROOT, from)
  if (!existsSync(source)) {
    console.error(`  ✗ manca ${from} — esegui prima "npm install"`)
    process.exitCode = 1
    continue
  }
  cpSync(source, resolve(PUBLIC, to), { recursive: true })
  console.log(`  ✓ ${to}/`)
}

const tessdata = resolve(PUBLIC, 'tessdata/ita.traineddata.gz')
mkdirSync(dirname(tessdata), { recursive: true })

const response = await fetch(TESSDATA_URL)
if (!response.ok) {
  console.error(`  ✗ download del modello italiano non riuscito (HTTP ${response.status})`)
  process.exit(1)
}
const bytes = new Uint8Array(await response.arrayBuffer())
// Controllo minimo di integrità: i primi due byte di un file gzip sono 1f 8b.
if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
  console.error('  ✗ il file scaricato non è un archivio gzip valido')
  process.exit(1)
}
writeFileSync(tessdata, bytes)
console.log(`  ✓ tessdata/ita.traineddata.gz  (${kb(bytes.byteLength)})`)
console.log('\nAsset OCR pronti: l\'applicazione non farà alcuna richiesta di rete a runtime.')
