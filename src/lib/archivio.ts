/**
 * Servizio centrale del caveau: possiede la DEK in memoria, media ogni accesso
 * ai dati e non espone mai nulla in chiaro verso il disco.
 *
 * È deliberatamente indipendente da React: la UI lo consuma tramite
 * `ArchivioProvider`, sottoscrivendosi a `subscribe()`.
 */
import {
  decryptBytes,
  decryptJson,
  deriveKeyFromPin,
  deriveKeyFromPrf,
  encryptBytes,
  encryptJson,
  generateDataKey,
  newSalt,
  PBKDF2_ITERATIONS,
  randomId,
  unwrapDataKey,
  wrapDataKey,
} from './crypto'
import {
  deleteEncrypted,
  deleteMany,
  deleteWrappedKey,
  getAllEncrypted,
  getEncrypted,
  isInitialized,
  listWrappedKeys,
  putEncrypted,
  putWrappedKey,
  requestPersistentStorage,
  wipeEverything,
  type WrappedKeyRecord,
} from './db'
import {
  BiometricCancelledError,
  BiometricUnsupportedError,
  evaluatePrf,
  probeBiometricSupport,
  registerBiometric,
  verifyUserPresence,
} from './webauthn'
import {
  DEFAULT_SETTINGS,
  type AssetRef,
  type PinnedField,
  type Profile,
  type Settings,
  type Side,
  type ArchivioDocument,
} from '../types'

export type ArchivioStatus = 'loading' | 'uninitialized' | 'locked' | 'unlocked'

export interface ArchivioSnapshot {
  status: ArchivioStatus
  documents: ArchivioDocument[]
  profiles: Profile[]
  settings: Settings
  /** Metodi di sblocco configurati, per la schermata di blocco e Impostazioni. */
  methods: { id: string; kind: 'biometric' | 'pin'; label: string; createdAt: number }[]
  /** Ultimo errore leggibile, azzerato dal chiamante. */
  error: string | null
}

/** L'etichetta PRF: cambiarla invaliderebbe tutte le chiavi biometriche esistenti. */
const PRF_INFO = 'archivio-documenti/dek-v1'
const SELF_PROFILE_ID = 'self'

export class ArchivioLockedError extends Error {
  constructor() {
    super('Il caveau è bloccato.')
    this.name = 'ArchivioLockedError'
  }
}

export class WrongPinError extends Error {
  constructor() {
    super('PIN o password non corretti.')
    this.name = 'WrongPinError'
  }
}

class ArchivioService {
  private dek: CryptoKey | null = null
  private status: ArchivioStatus = 'loading'
  private documents = new Map<string, ArchivioDocument>()
  private profiles = new Map<string, Profile>()
  private settings: Settings = { ...DEFAULT_SETTINGS }
  private keys: WrappedKeyRecord[] = []
  private error: string | null = null
  private listeners = new Set<(s: ArchivioSnapshot) => void>()
  /** Timestamp dell'ultima verifica d'identità riuscita, per la riconferma. */
  private lastVerifiedAt = 0

  /* --------------------------- sottoscrizione --------------------------- */

  subscribe(fn: (s: ArchivioSnapshot) => void): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => this.listeners.delete(fn)
  }

  snapshot(): ArchivioSnapshot {
    return {
      status: this.status,
      documents: [...this.documents.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      profiles: [...this.profiles.values()].sort((a, b) =>
        a.isSelf === b.isSelf ? a.createdAt - b.createdAt : a.isSelf ? -1 : 1,
      ),
      settings: this.settings,
      methods: this.keys.map((k) => ({
        id: k.id,
        kind: k.kind,
        label: k.label,
        createdAt: k.createdAt,
      })),
      error: this.error,
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const fn of this.listeners) fn(snap)
  }

  private setError(err: unknown): never {
    this.error = err instanceof Error ? err.message : String(err)
    this.emit()
    throw err
  }

  clearError(): void {
    if (this.error !== null) {
      this.error = null
      this.emit()
    }
  }

  /* ------------------------------ bootstrap ----------------------------- */

  async bootstrap(): Promise<void> {
    this.keys = await listWrappedKeys()
    this.status = (await isInitialized()) ? 'locked' : 'uninitialized'
    this.emit()
  }

  hasBiometricMethod(): boolean {
    return this.keys.some((k) => k.kind === 'biometric')
  }

  hasPinMethod(): boolean {
    return this.keys.some((k) => k.kind === 'pin')
  }

  /* --------------------------- inizializzazione -------------------------- */

  /** Primo avvio con biometria. Crea la DEK e la avvolge con la KEK del PRF. */
  async initializeWithBiometric(): Promise<void> {
    try {
      const dek = await generateDataKey()
      await this.addBiometricInternal(dek)
      await this.finishInitialization(dek)
    } catch (err) {
      this.setError(err)
    }
  }

  /** Primo avvio con PIN o password. */
  async initializeWithPin(pin: string): Promise<void> {
    try {
      const dek = await generateDataKey()
      await this.addPinInternal(dek, pin)
      await this.finishInitialization(dek)
    } catch (err) {
      this.setError(err)
    }
  }

  private async finishInitialization(dek: CryptoKey): Promise<void> {
    this.dek = dek
    this.status = 'unlocked'
    this.lastVerifiedAt = Date.now()
    // Profilo principale, sempre presente e non eliminabile.
    const self: Profile = {
      id: SELF_PROFILE_ID,
      name: 'I miei documenti',
      colorIndex: 0,
      isSelf: true,
      createdAt: Date.now(),
    }
    this.profiles.set(self.id, self)
    await putEncrypted('profiles', self.id, await encryptJson(self, dek))
    await this.persistSettings()
    await requestPersistentStorage()
    this.keys = await listWrappedKeys()
    this.emit()
  }

  /* ------------------------- gestione dei metodi ------------------------- */

  private async addBiometricInternal(dek: CryptoKey): Promise<void> {
    // Tutti i credential condividono lo stesso salt PRF: l'output resta comunque
    // diverso per ogni credential, quindi ogni metodo ha la sua DEK avvolta.
    const existing = this.keys.find((k) => k.kind === 'biometric' && k.prfSalt)
    const prfSalt = existing?.prfSalt ?? newSalt()
    const { credentialId, prfOutput, label } = await registerBiometric(prfSalt)
    const kek = await deriveKeyFromPrf(prfOutput, PRF_INFO)
    const wrapped = await wrapDataKey(dek, kek)
    await putWrappedKey({
      id: `biometric:${bufToHex(credentialId)}`,
      kind: 'biometric',
      iv: wrapped.iv,
      data: wrapped.data,
      credentialId,
      prfSalt,
      label,
      createdAt: Date.now(),
    })
  }

  private async addPinInternal(dek: CryptoKey, pin: string): Promise<void> {
    if (pin.length < 4) throw new Error('Il PIN deve avere almeno 4 caratteri.')
    const salt = newSalt()
    const kek = await deriveKeyFromPin(pin, salt)
    const wrapped = await wrapDataKey(dek, kek)
    await putWrappedKey({
      id: 'pin',
      kind: 'pin',
      iv: wrapped.iv,
      data: wrapped.data,
      salt,
      iterations: PBKDF2_ITERATIONS,
      label: /^\d+$/.test(pin) ? 'PIN numerico' : 'Password',
      createdAt: Date.now(),
    })
  }

  /** Aggiunge la biometria a caveau già sbloccato (da Impostazioni). */
  async enableBiometric(): Promise<void> {
    const dek = this.requireKey()
    try {
      await this.addBiometricInternal(dek)
      this.keys = await listWrappedKeys()
      this.emit()
    } catch (err) {
      this.setError(err)
    }
  }

  /** Imposta o sostituisce il PIN a caveau sbloccato. */
  async setPin(pin: string): Promise<void> {
    const dek = this.requireKey()
    try {
      await this.addPinInternal(dek, pin)
      this.keys = await listWrappedKeys()
      this.emit()
    } catch (err) {
      this.setError(err)
    }
  }

  /** Rimuove un metodo di sblocco, rifiutando di lasciare il caveau inaccessibile. */
  async removeMethod(id: string): Promise<void> {
    if (this.keys.length <= 1) {
      this.setError(new Error('Deve restare almeno un metodo di sblocco attivo.'))
    }
    await deleteWrappedKey(id)
    this.keys = await listWrappedKeys()
    this.emit()
  }

  /* -------------------------------- sblocco ------------------------------ */

  async unlockWithBiometric(): Promise<void> {
    const candidates = this.keys.filter((k) => k.kind === 'biometric')
    if (candidates.length === 0) this.setError(new Error('Nessun metodo biometrico registrato.'))
    const prfSalt = candidates[0].prfSalt!
    try {
      const assertion = await evaluatePrf(
        candidates.map((k) => k.credentialId!),
        prfSalt,
      )
      if (!assertion) throw new BiometricUnsupportedError()
      const hex = bufToHex(assertion.credentialId)
      const record = candidates.find((k) => k.id === `biometric:${hex}`)
      if (!record) {
        throw new Error('Il credential usato non è associato a questo caveau.')
      }
      const kek = await deriveKeyFromPrf(assertion.prfOutput, PRF_INFO)
      const dek = await unwrapDataKey({ iv: record.iv, data: record.data }, kek)
      await putWrappedKey({ ...record, lastUsedAt: Date.now() })
      await this.completeUnlock(dek)
    } catch (err) {
      if (err instanceof BiometricCancelledError) throw err
      this.setError(err)
    }
  }

  async unlockWithPin(pin: string): Promise<void> {
    const record = this.keys.find((k) => k.kind === 'pin')
    if (!record) this.setError(new Error('Nessun PIN configurato.'))
    try {
      const kek = await deriveKeyFromPin(pin, record!.salt!, record!.iterations)
      const dek = await unwrapDataKey({ iv: record!.iv, data: record!.data }, kek).catch(() => {
        // Un fallimento GCM qui significa quasi certamente PIN errato.
        throw new WrongPinError()
      })
      await putWrappedKey({ ...record!, lastUsedAt: Date.now() })
      await this.completeUnlock(dek)
    } catch (err) {
      this.setError(err)
    }
  }

  private async completeUnlock(dek: CryptoKey): Promise<void> {
    this.dek = dek
    this.lastVerifiedAt = Date.now()
    await this.loadAll()
    await this.suggestInitialPins()
    this.status = 'unlocked'
    this.error = null
    this.emit()
  }

  private async loadAll(): Promise<void> {
    const dek = this.requireKey()

    const docRecords = await getAllEncrypted('documents')
    this.documents.clear()
    for (const rec of docRecords) {
      try {
        const doc = await decryptJson<ArchivioDocument>({ iv: rec.iv, data: rec.data }, dek)
        this.documents.set(doc.id, doc)
      } catch {
        console.warn('[archivio] record documento non decifrabile, ignorato:', rec.id)
      }
    }

    const profileRecords = await getAllEncrypted('profiles')
    this.profiles.clear()
    for (const rec of profileRecords) {
      try {
        const p = await decryptJson<Profile>({ iv: rec.iv, data: rec.data }, dek)
        this.profiles.set(p.id, p)
      } catch {
        console.warn('[archivio] record profilo non decifrabile, ignorato:', rec.id)
      }
    }

    const settingsRec = await getEncrypted('appState', 'settings')
    if (settingsRec) {
      try {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...(await decryptJson<Partial<Settings>>(
            { iv: settingsRec.iv, data: settingsRec.data },
            dek,
          )),
        }
      } catch {
        this.settings = { ...DEFAULT_SETTINGS }
      }
    }
  }

  /** Chiude il caveau: la DEK viene dimenticata, i dati restano cifrati su disco. */
  lock(): void {
    this.dek = null
    this.documents.clear()
    this.profiles.clear()
    this.lastVerifiedAt = 0
    if (this.status === 'unlocked') this.status = 'locked'
    this.emit()
  }

  isUnlocked(): boolean {
    return this.dek !== null && this.status === 'unlocked'
  }

  private requireKey(): CryptoKey {
    if (!this.dek) throw new ArchivioLockedError()
    return this.dek
  }

  /* --------------------- riconferma d'identità (step-up) ------------------ */

  /**
   * Verifica l'identità prima di un'azione sensibile (apertura o condivisione).
   * Con biometria disponibile chiede una nuova asserzione; altrimenti la UI deve
   * raccogliere il PIN e chiamare `verifyPin`.
   */
  async verifyPresence(): Promise<boolean> {
    const candidates = this.keys.filter((k) => k.kind === 'biometric')
    if (candidates.length === 0) return false
    const ok = await verifyUserPresence(candidates.map((k) => k.credentialId!))
    if (ok) this.lastVerifiedAt = Date.now()
    return ok
  }

  /** Verifica il PIN senza modificare lo stato di sblocco. */
  async verifyPin(pin: string): Promise<boolean> {
    const record = this.keys.find((k) => k.kind === 'pin')
    if (!record) return false
    try {
      const kek = await deriveKeyFromPin(pin, record.salt!, record.iterations)
      await unwrapDataKey({ iv: record.iv, data: record.data }, kek)
      this.lastVerifiedAt = Date.now()
      return true
    } catch {
      return false
    }
  }

  /** True se una verifica è avvenuta negli ultimi `seconds` secondi. */
  recentlyVerified(seconds = 20): boolean {
    return Date.now() - this.lastVerifiedAt < seconds * 1000
  }

  async biometricAvailable(): Promise<boolean> {
    if (!this.hasBiometricMethod()) return false
    const support = await probeBiometricSupport()
    return support.webauthn && support.secureContext
  }

  /* ------------------------------ documenti ------------------------------ */

  getDocument(id: string): ArchivioDocument | undefined {
    return this.documents.get(id)
  }

  async saveDocument(doc: ArchivioDocument): Promise<void> {
    const dek = this.requireKey()
    const next = { ...doc, updatedAt: Date.now() }
    await putEncrypted('documents', next.id, await encryptJson(next, dek), next.updatedAt)
    this.documents.set(next.id, next)
    this.emit()
  }

  /** Salva un binario (immagine o PDF) e restituisce il riferimento da mettere nel documento. */
  async saveAsset(file: Blob, side: Side, extra: Partial<AssetRef> = {}): Promise<AssetRef> {
    const dek = this.requireKey()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const id = randomId()
    await putEncrypted('assets', id, await encryptBytes(bytes, dek))
    return {
      id,
      side,
      mime: file.type || 'application/octet-stream',
      size: bytes.byteLength,
      addedAt: Date.now(),
      ...extra,
    }
  }

  /** Rilegge un binario decifrandolo in memoria. */
  async loadAsset(ref: AssetRef): Promise<Blob> {
    const dek = this.requireKey()
    const rec = await getEncrypted('assets', ref.id)
    if (!rec) throw new Error('File non trovato nel caveau.')
    const bytes = await decryptBytes({ iv: rec.iv, data: rec.data }, dek)
    return new Blob([bytes as BlobPart], { type: ref.mime })
  }

  async deleteAsset(ref: AssetRef): Promise<void> {
    await deleteEncrypted('assets', ref.id)
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = this.documents.get(id)
    if (!doc) return
    await deleteMany(
      'assets',
      doc.assets.map((a) => a.id),
    )
    await deleteEncrypted('documents', id)
    this.documents.delete(id)
    // Un pin che punta a un documento eliminato è spazzatura: via subito.
    const pinned = this.settings.pinnedFields ?? []
    if (pinned.some((p) => p.docId === id)) {
      await this.updateSettings({ pinnedFields: pinned.filter((p) => p.docId !== id) })
    }
    this.emit()
  }

  /* ------------------------------- profili ------------------------------- */

  async saveProfile(profile: Profile): Promise<void> {
    const dek = this.requireKey()
    await putEncrypted('profiles', profile.id, await encryptJson(profile, dek))
    this.profiles.set(profile.id, profile)
    this.emit()
  }

  /** Elimina un profilo familiare e tutti i suoi documenti. */
  async deleteProfile(id: string): Promise<void> {
    if (id === SELF_PROFILE_ID) {
      this.setError(new Error('Il profilo principale non può essere eliminato.'))
    }
    const docs = [...this.documents.values()].filter((d) => d.profileId === id)
    for (const doc of docs) await this.deleteDocument(doc.id)
    await deleteEncrypted('profiles', id)
    this.profiles.delete(id)
    this.emit()
  }

  /* --------------------------- dati rapidi (pin) ------------------------- */

  /** Appunta o rimuove un campo dalla sezione dei dati rapidi. */
  async togglePinnedField(docId: string, key: PinnedField['key']): Promise<boolean> {
    const current = this.settings.pinnedFields ?? []
    const exists = current.some((p) => p.docId === docId && p.key === key)
    const next = exists
      ? current.filter((p) => !(p.docId === docId && p.key === key))
      : [...current, { docId, key }]
    await this.updateSettings({ pinnedFields: next })
    return !exists
  }

  isPinned(docId: string, key: PinnedField['key']): boolean {
    return (this.settings.pinnedFields ?? []).some((p) => p.docId === docId && p.key === key)
  }

  /**
   * Campi appuntati ancora validi, con il valore corrente. I riferimenti a
   * documenti o campi che non esistono più vengono ignorati qui e ripuliti dal
   * prossimo salvataggio delle impostazioni.
   */
  pinnedEntries(): { docId: string; key: PinnedField['key']; value: string; title: string }[] {
    const out: { docId: string; key: PinnedField['key']; value: string; title: string }[] = []
    for (const pin of this.settings.pinnedFields ?? []) {
      const doc = this.documents.get(pin.docId)
      const field = doc?.fields.find((f) => f.key === pin.key)
      if (doc && field) out.push({ docId: pin.docId, key: pin.key, value: field.value, title: doc.title })
    }
    return out
  }

  /**
   * Al primo sblocco propone il codice fiscale del profilo principale: è il
   * dato che in Italia si chiede più spesso, e senza questo suggerimento la
   * sezione resterebbe vuota finché l'utente non scopre il pin da sé.
   */
  private async suggestInitialPins(): Promise<void> {
    if (this.settings.pinnedSuggested) return
    const candidate = [...this.documents.values()]
      .filter((d) => d.profileId === SELF_PROFILE_ID)
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((doc) => {
        const field = doc.fields.find((f) => f.key === 'fiscalCode')
        return field ? [{ docId: doc.id, key: field.key }] : []
      })[0]

    // Il flag si alza comunque: se non c'era un codice fiscale da proporre, non
    // ha senso riprovare a ogni sblocco.
    await this.updateSettings({
      pinnedSuggested: true,
      pinnedFields: candidate ? [candidate] : (this.settings.pinnedFields ?? []),
    })
  }

  /* ----------------------------- impostazioni ---------------------------- */

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await this.persistSettings()
    this.emit()
  }

  private async persistSettings(): Promise<void> {
    const dek = this.requireKey()
    await putEncrypted('appState', 'settings', await encryptJson(this.settings, dek))
  }

  /* ------------------------- accesso interno (backup) -------------------- */

  /** Usato solo da `backup.ts`, che vive nello stesso confine di sicurezza. */
  internalKey(): CryptoKey {
    return this.requireKey()
  }

  async replaceAll(documents: ArchivioDocument[], profiles: Profile[], settings: Settings): Promise<void> {
    const dek = this.requireKey()
    for (const p of profiles) {
      await putEncrypted('profiles', p.id, await encryptJson(p, dek))
      this.profiles.set(p.id, p)
    }
    for (const d of documents) {
      await putEncrypted('documents', d.id, await encryptJson(d, dek), d.updatedAt)
      this.documents.set(d.id, d)
    }
    this.settings = settings
    await this.persistSettings()
    this.emit()
  }

  /** Reinserisce un binario proveniente da un backup, conservandone l'id. */
  async restoreAsset(id: string, bytes: Uint8Array): Promise<void> {
    const dek = this.requireKey()
    await putEncrypted('assets', id, await encryptBytes(bytes, dek))
  }

  async readAssetBytes(id: string): Promise<Uint8Array | null> {
    const dek = this.requireKey()
    const rec = await getEncrypted('assets', id)
    if (!rec) return null
    return decryptBytes({ iv: rec.iv, data: rec.data }, dek)
  }

  /** Distruzione totale e irreversibile del caveau su questo dispositivo. */
  async destroyEverything(): Promise<void> {
    await wipeEverything()
    this.dek = null
    this.documents.clear()
    this.profiles.clear()
    this.keys = []
    this.settings = { ...DEFAULT_SETTINGS }
    this.status = 'uninitialized'
    this.emit()
  }
}

function bufToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Istanza unica per l'intera applicazione. */
export const archivio = new ArchivioService()
export { SELF_PROFILE_ID }
