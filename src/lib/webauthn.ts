/**
 * Sblocco biometrico via WebAuthn con estensione PRF.
 *
 * Il PRF ("pseudo-random function") permette di ottenere 32 byte deterministici
 * dall'autenticatore: sono il segreto da cui deriviamo la KEK che avvolge la DEK.
 * Il segreto non lascia mai il Secure Enclave in forma riutilizzabile e non è
 * ricavabile senza il consenso biometrico dell'utente.
 *
 * Conseguenza architetturale: la chiave è legata al dispositivo. Il trasferimento
 * su un altro telefono passa necessariamente dal backup cifrato con passphrase
 * (vedi `backup.ts`), non dalla biometria.
 */

/* --- Tipi delle estensioni PRF, non ancora presenti nelle lib TS standard --- */

interface PrfValues {
  first: BufferSource
  second?: BufferSource
}

interface PrfInput {
  eval?: PrfValues
}

interface PrfOutput {
  enabled?: boolean
  results?: { first: ArrayBuffer; second?: ArrayBuffer }
}

type ExtendedClientInputs = AuthenticationExtensionsClientInputs & { prf?: PrfInput }
type ExtendedClientOutputs = AuthenticationExtensionsClientOutputs & { prf?: PrfOutput }

export class BiometricUnsupportedError extends Error {
  constructor(message = 'Questo dispositivo o browser non supporta lo sblocco biometrico cifrato.') {
    super(message)
    this.name = 'BiometricUnsupportedError'
  }
}

export class BiometricCancelledError extends Error {
  constructor(message = 'Autenticazione annullata.') {
    super(message)
    this.name = 'BiometricCancelledError'
  }
}

export interface BiometricSupport {
  /** L'API WebAuthn esiste in questo browser. */
  webauthn: boolean
  /** Esiste un autenticatore integrato nel dispositivo (Face ID, Touch ID, Windows Hello...). */
  platformAuthenticator: boolean
  /** Il contesto è sicuro (https o localhost): requisito assoluto. */
  secureContext: boolean
}

export async function probeBiometricSupport(): Promise<BiometricSupport> {
  const secureContext = window.isSecureContext
  const webauthn =
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  let platformAuthenticator = false
  if (
    webauthn &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  ) {
    try {
      platformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    } catch {
      platformAuthenticator = false
    }
  }
  return { webauthn, platformAuthenticator, secureContext }
}

const RP_NAME = 'Archivio Documenti'
/** Gli algoritmi vanno dichiarati: ES256 e RS256 coprono tutti gli autenticatori reali. */
const PUB_KEY_ALGS: PublicKeyCredentialParameters[] = [
  { type: 'public-key', alg: -7 },
  { type: 'public-key', alg: -257 },
]

function isCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
}

export interface RegisteredCredential {
  credentialId: Uint8Array
  prfOutput: ArrayBuffer
  label: string
}

/**
 * Registra un nuovo credential biometrico e restituisce subito il suo output PRF.
 *
 * Il PRF viene letto con una `get()` immediatamente successiva alla `create()`:
 * alcuni browser non restituiscono i risultati PRF durante la creazione, ma tutti
 * quelli che supportano l'estensione li restituiscono in fase di asserzione.
 */
export async function registerBiometric(
  prfSalt: Uint8Array,
  label = deviceLabel(),
): Promise<RegisteredCredential> {
  const support = await probeBiometricSupport()
  if (!support.secureContext) {
    throw new BiometricUnsupportedError(
      'La biometria richiede una connessione sicura (https) oppure localhost.',
    )
  }
  if (!support.webauthn) throw new BiometricUnsupportedError()

  // userHandle casuale: non contiene e non rivela alcun dato personale.
  const userId = crypto.getRandomValues(new Uint8Array(32))

  let credential: PublicKeyCredential | null
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: RP_NAME, id: window.location.hostname },
        user: { id: userId, name: 'archivio-locale', displayName: 'Caveau locale' },
        pubKeyCredParams: PUB_KEY_ALGS,
        timeout: 120_000,
        attestation: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        extensions: { prf: {} } as ExtendedClientInputs,
      },
    })) as PublicKeyCredential | null
  } catch (err) {
    if (isCancel(err)) throw new BiometricCancelledError()
    throw new BiometricUnsupportedError(
      'Non è stato possibile registrare la biometria su questo dispositivo.',
    )
  }
  if (!credential) throw new BiometricUnsupportedError()

  const created = credential.getClientExtensionResults() as ExtendedClientOutputs
  if (created.prf?.enabled === false) {
    throw new BiometricUnsupportedError(
      'L’autenticatore di questo dispositivo non supporta la derivazione di chiavi (estensione PRF). Imposta un PIN.',
    )
  }

  const credentialId = new Uint8Array(credential.rawId)
  const prf = await evaluatePrf([credentialId], prfSalt)
  if (!prf) {
    throw new BiometricUnsupportedError(
      'Questo browser non espone l’estensione PRF di WebAuthn: la cifratura tramite biometria non è possibile. Imposta un PIN come metodo di sblocco.',
    )
  }
  return { credentialId, prfOutput: prf.prfOutput, label }
}

export interface PrfAssertion {
  credentialId: Uint8Array
  prfOutput: ArrayBuffer
}

/**
 * Chiede all'utente il consenso biometrico e restituisce l'output PRF.
 * `allowed` vuoto significa "qualsiasi credential registrato per questo sito".
 */
export async function evaluatePrf(
  allowed: Uint8Array[],
  prfSalt: Uint8Array,
): Promise<PrfAssertion | null> {
  let assertion: PublicKeyCredential | null
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        timeout: 120_000,
        userVerification: 'required',
        allowCredentials: allowed.map((id) => ({ type: 'public-key' as const, id: id as BufferSource })),
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as ExtendedClientInputs,
      },
    })) as PublicKeyCredential | null
  } catch (err) {
    if (isCancel(err)) throw new BiometricCancelledError()
    throw err
  }
  if (!assertion) return null

  const results = (assertion.getClientExtensionResults() as ExtendedClientOutputs).prf?.results
  if (!results?.first) return null
  return { credentialId: new Uint8Array(assertion.rawId), prfOutput: results.first }
}

/**
 * Verifica di presenza utente senza bisogno del PRF: usata per la riconferma
 * prima di aprire o condividere un documento quando il caveau è già sbloccato.
 */
export async function verifyUserPresence(allowed: Uint8Array[]): Promise<boolean> {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        timeout: 120_000,
        userVerification: 'required',
        allowCredentials: allowed.map((id) => ({ type: 'public-key' as const, id: id as BufferSource })),
      },
    })
    return assertion !== null
  } catch (err) {
    if (isCancel(err)) throw new BiometricCancelledError()
    throw err
  }
}

/** Etichetta leggibile del dispositivo, per distinguere i credential in Impostazioni. */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Dispositivo'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  return `${platform} · ${browser}`
}
