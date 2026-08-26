/**
 * Primitive crittografiche del caveau — tutto via Web Crypto API, zero librerie.
 *
 * Modello:
 *  - Esiste una sola chiave dati (DEK, AES-GCM 256) generata casualmente al setup.
 *  - La DEK non è mai salvata in chiaro: viene "avvolta" (wrapped) da una o più KEK.
 *  - Una KEK nasce dal PRF di WebAuthn (biometria) oppure da PBKDF2 su PIN/password.
 *  - Ogni record su disco è cifrato con la DEK e un IV casuale di 12 byte.
 *
 * La DEK esiste in chiaro solo in memoria, per la durata della sessione sbloccata.
 */

const AES = 'AES-GCM'
const IV_BYTES = 12
const SALT_BYTES = 16

/** Costo PBKDF2 per il PIN. Alto di proposito: lo sblocco è un'operazione rara. */
export const PBKDF2_ITERATIONS = 650_000

export interface Envelope {
  /** IV a 12 byte. */
  iv: Uint8Array
  /** Testo cifrato (include il tag di autenticazione GCM). */
  data: Uint8Array
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function randomId(): string {
  // crypto.randomUUID non è disponibile in contesti non sicuri su alcuni browser.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/* ------------------------------------------------------------------ *
 * Generazione e derivazione delle chiavi
 * ------------------------------------------------------------------ */

/** Nuova DEK casuale. Estraibile perché deve poter essere avvolta e messa nel backup. */
export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES, length: 256 }, true, ['encrypt', 'decrypt'])
}

/** KEK da PIN/password. Il salt va conservato in chiaro accanto alla DEK avvolta. */
export async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * KEK dall'output PRF di WebAuthn. Il PRF restituisce 32 byte deterministici,
 * legati al credential e al `salt` richiesto: li passiamo per HKDF per non usare
 * mai direttamente il segreto grezzo come chiave.
 */
export async function deriveKeyFromPrf(prfOutput: ArrayBuffer, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    material,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ------------------------------------------------------------------ *
 * Wrapping della DEK
 * ------------------------------------------------------------------ */

export async function wrapDataKey(dek: CryptoKey, kek: CryptoKey): Promise<Envelope> {
  const raw = await crypto.subtle.exportKey('raw', dek)
  return encryptBytes(new Uint8Array(raw), kek)
}

export async function unwrapDataKey(env: Envelope, kek: CryptoKey): Promise<CryptoKey> {
  const raw = await decryptBytes(env, kek)
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: AES, length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

/* ------------------------------------------------------------------ *
 * Cifratura dei dati
 * ------------------------------------------------------------------ */

export async function encryptBytes(plain: Uint8Array, key: CryptoKey): Promise<Envelope> {
  const iv = randomBytes(IV_BYTES)
  const data = await crypto.subtle.encrypt(
    { name: AES, iv: iv as BufferSource },
    key,
    plain as BufferSource,
  )
  return { iv, data: new Uint8Array(data) }
}

export async function decryptBytes(env: Envelope, key: CryptoKey): Promise<Uint8Array> {
  const out = await crypto.subtle.decrypt(
    { name: AES, iv: env.iv as BufferSource },
    key,
    env.data as BufferSource,
  )
  return new Uint8Array(out)
}

export async function encryptJson<T>(value: T, key: CryptoKey): Promise<Envelope> {
  return encryptBytes(new TextEncoder().encode(JSON.stringify(value)), key)
}

export async function decryptJson<T>(env: Envelope, key: CryptoKey): Promise<T> {
  const bytes = await decryptBytes(env, key)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

/* ------------------------------------------------------------------ *
 * Utilità
 * ------------------------------------------------------------------ */

export function newSalt(): Uint8Array {
  return randomBytes(SALT_BYTES)
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000 // evita "too many arguments" su file grandi
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Confronto a tempo costante, per non dare indizi temporali sui segreti. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Stima grossolana della robustezza di un PIN/password, 0..4. */
export function passphraseStrength(value: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  const len = value.length
  let bits = 0
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length
  bits = len * Math.log2(Math.max(10, classes * 20))
  const onlyDigits = /^\d+$/.test(value)
  if (onlyDigits) bits = len * Math.log2(10)
  const score = bits < 26 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4
  const labels = ['Molto debole', 'Debole', 'Discreta', 'Buona', 'Eccellente'] as const
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] }
}
