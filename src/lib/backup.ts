/**
 * Backup ed esportazione multi-dispositivo.
 *
 * Il file `.archbk` è un contenitore binario cifrato con una passphrase scelta
 * dall'utente al momento dell'esportazione. Serve una passphrase dedicata e non
 * la biometria perché la chiave biometrica è legata al Secure Enclave del
 * dispositivo: non può, per costruzione, essere riprodotta su un altro telefono.
 *
 * Struttura del file:
 *
 *   "ADOCBK01"            8 byte, magic
 *   uint32 LE             lunghezza dell'header JSON
 *   header JSON           parametri KDF in chiaro (salt, iterazioni, IV): pubblici
 *   ciphertext            AES-GCM del payload
 *
 * Payload in chiaro (dopo la decifratura):
 *
 *   uint32 LE + JSON      metadati: documenti, profili, impostazioni, id degli allegati
 *   per ogni allegato:    uint32 LE lunghezza + byte del file
 *
 * I binari restano binari: nessun base64, così un caveau da 200 MB non fa
 * esplodere la memoria del telefono durante l'esportazione.
 */
import { deriveKeyFromPin, encryptBytes, decryptBytes, newSalt, PBKDF2_ITERATIONS, toBase64, fromBase64 } from './crypto'
import { archivio } from './archivio'
import type { Profile, Settings, ArchivioDocument } from '../types'

const MAGIC = 'ADOCBK01'
const FORMAT_VERSION = 1

interface BackupHeader {
  format: string
  version: number
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  createdAt: number
  /** Solo informativi, per mostrare un riepilogo prima di importare. */
  documentCount: number
  profileCount: number
  app: string
}

interface BackupMeta {
  documents: ArchivioDocument[]
  profiles: Profile[]
  settings: Settings
  /** Ordine con cui gli allegati compaiono nel payload. */
  assetIds: string[]
}

export interface BackupSummary {
  createdAt: number
  documentCount: number
  profileCount: number
  version: number
}

export class BackupFormatError extends Error {
  constructor(message = 'Il file selezionato non è un backup valido di Archivio Documenti.') {
    super(message)
    this.name = 'BackupFormatError'
  }
}

export class BackupPassphraseError extends Error {
  constructor() {
    super('Passphrase errata: impossibile decifrare il backup.')
    this.name = 'BackupPassphraseError'
  }
}

/* ------------------------------ esportazione ------------------------------ */

export interface ExportProgress {
  phase: 'collecting' | 'encrypting' | 'done'
  current: number
  total: number
}

/**
 * Costruisce il file di backup. Il chiamante deve avere già ottenuto la
 * riconferma biometrica o PIN: qui il caveau viene solo letto.
 */
export async function exportBackup(
  passphrase: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (passphrase.length < 8) {
    throw new Error('La passphrase del backup deve avere almeno 8 caratteri.')
  }
  const snapshot = archivio.snapshot()
  const documents = snapshot.documents
  const profiles = snapshot.profiles

  const assetIds = documents.flatMap((d) => d.assets.map((a) => a.id))
  const chunks: Uint8Array[] = []
  const meta: BackupMeta = {
    documents,
    profiles,
    settings: snapshot.settings,
    assetIds: [],
  }

  // Prima gli allegati, così `assetIds` riflette esattamente l'ordine nel payload.
  const assetBlocks: Uint8Array[] = []
  for (let i = 0; i < assetIds.length; i++) {
    const id = assetIds[i]
    onProgress?.({ phase: 'collecting', current: i + 1, total: assetIds.length })
    const bytes = await archivio.readAssetBytes(id)
    if (!bytes) continue // allegato mancante: il documento resterà senza immagine
    meta.assetIds.push(id)
    assetBlocks.push(uint32(bytes.byteLength), bytes)
  }

  const metaBytes = new TextEncoder().encode(JSON.stringify(meta))
  chunks.push(uint32(metaBytes.byteLength), metaBytes, ...assetBlocks)
  const payload = concat(chunks)

  onProgress?.({ phase: 'encrypting', current: 1, total: 1 })
  const salt = newSalt()
  const key = await deriveKeyFromPin(passphrase, salt)
  const { iv, data } = await encryptBytes(payload, key)

  const header: BackupHeader = {
    format: MAGIC,
    version: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    createdAt: Date.now(),
    documentCount: documents.length,
    profileCount: profiles.length,
    app: 'archivio-documenti',
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))

  onProgress?.({ phase: 'done', current: 1, total: 1 })
  return new Blob(
    [
      new TextEncoder().encode(MAGIC) as BlobPart,
      uint32(headerBytes.byteLength) as BlobPart,
      headerBytes as BlobPart,
      data as BlobPart,
    ],
    { type: 'application/octet-stream' },
  )
}

export function backupFilename(): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')
  return `archivio-documenti-${stamp}.archbk`
}

/* ------------------------------ importazione ------------------------------ */

interface ParsedBackup {
  header: BackupHeader
  ciphertext: Uint8Array
}

function parseContainer(bytes: Uint8Array): ParsedBackup {
  const decoder = new TextDecoder()
  if (bytes.byteLength < 12) throw new BackupFormatError()
  if (decoder.decode(bytes.subarray(0, 8)) !== MAGIC) throw new BackupFormatError()

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLen = view.getUint32(8, true)
  if (headerLen === 0 || headerLen > 1 << 20 || 12 + headerLen > bytes.byteLength) {
    throw new BackupFormatError()
  }
  let header: BackupHeader
  try {
    header = JSON.parse(decoder.decode(bytes.subarray(12, 12 + headerLen))) as BackupHeader
  } catch {
    throw new BackupFormatError()
  }
  if (header.format !== MAGIC || header.version > FORMAT_VERSION) {
    throw new BackupFormatError(
      'Questo backup è stato creato con una versione più recente dell’app: aggiorna Archivio Documenti e riprova.',
    )
  }
  return { header, ciphertext: bytes.subarray(12 + headerLen) }
}

/** Legge solo l'intestazione: serve a mostrare un riepilogo prima di importare. */
export async function inspectBackup(file: Blob): Promise<BackupSummary> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  const { header } = parseContainer(head)
  return {
    createdAt: header.createdAt,
    documentCount: header.documentCount,
    profileCount: header.profileCount,
    version: header.version,
  }
}

export interface ImportResult {
  documentsAdded: number
  documentsUpdated: number
  documentsSkipped: number
  profilesAdded: number
  assetsRestored: number
}

/**
 * Importa un backup nel caveau corrente.
 *
 * La strategia è di fusione: a parità di id vince il documento modificato più
 * di recente. Così importare un backup su un dispositivo già popolato non
 * distrugge nulla di più nuovo di quanto contenuto nel file.
 */
export async function importBackup(
  file: Blob,
  passphrase: string,
  options: { mode?: 'merge' | 'replace' } = {},
): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { header, ciphertext } = parseContainer(bytes)

  const key = await deriveKeyFromPin(passphrase, fromBase64(header.salt), header.iterations)
  let payload: Uint8Array
  try {
    payload = await decryptBytes({ iv: fromBase64(header.iv), data: ciphertext }, key)
  } catch {
    throw new BackupPassphraseError()
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const metaLen = view.getUint32(0, true)
  let offset = 4
  const meta = JSON.parse(new TextDecoder().decode(payload.subarray(offset, offset + metaLen))) as BackupMeta
  offset += metaLen

  // Ripristino degli allegati nell'ordine dichiarato.
  let assetsRestored = 0
  for (const id of meta.assetIds) {
    if (offset + 4 > payload.byteLength) break
    const len = view.getUint32(offset, true)
    offset += 4
    const data = payload.subarray(offset, offset + len)
    offset += len
    await archivio.restoreAsset(id, data)
    assetsRestored++
  }

  const existing = new Map(archivio.snapshot().documents.map((d) => [d.id, d]))
  const existingProfiles = new Map(archivio.snapshot().profiles.map((p) => [p.id, p]))
  const result: ImportResult = {
    documentsAdded: 0,
    documentsUpdated: 0,
    documentsSkipped: 0,
    profilesAdded: 0,
    assetsRestored,
  }

  const documents: ArchivioDocument[] = []
  for (const doc of meta.documents) {
    const current = existing.get(doc.id)
    if (!current) {
      documents.push(doc)
      result.documentsAdded++
    } else if (options.mode === 'replace' || doc.updatedAt > current.updatedAt) {
      documents.push(doc)
      result.documentsUpdated++
    } else {
      result.documentsSkipped++
    }
  }

  const profiles: Profile[] = []
  for (const profile of meta.profiles) {
    if (!existingProfiles.has(profile.id)) {
      profiles.push(profile)
      result.profilesAdded++
    } else if (options.mode === 'replace') {
      profiles.push(profile)
    }
  }

  const settings =
    options.mode === 'replace' ? meta.settings : { ...meta.settings, ...archivio.snapshot().settings }

  await archivio.replaceAll(documents, profiles, settings)
  return result
}

/* -------------------------------- utilità -------------------------------- */

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
