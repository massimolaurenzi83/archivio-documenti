/**
 * Persistenza locale su IndexedDB.
 *
 * Regola invariante: negli store `documents`, `profiles`, `assets` e `appState`
 * non esiste alcun campo in chiaro oltre alla chiave primaria. Tutto il resto è
 * un `Envelope` cifrato con la DEK. Lo store `auth`, per necessità, contiene in
 * chiaro solo parametri pubblici (salt, id credential, numero iterazioni) e la
 * DEK avvolta: nessuno di questi dati rivela contenuti.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Envelope } from './crypto'

export const DB_NAME = 'archivio-documenti'
export const DB_VERSION = 1

/** Record cifrato generico: la chiave è in chiaro, il contenuto no. */
export interface EncryptedRecord {
  id: string
  iv: Uint8Array
  data: Uint8Array
  /** Timestamp non sensibile, serve solo per ordinare senza decifrare tutto. */
  updatedAt: number
}

/** Come la DEK è stata avvolta da un determinato metodo di sblocco. */
export type WrapKind = 'biometric' | 'pin'

export interface WrappedKeyRecord {
  /** `biometric:<credentialId>` oppure `pin`. */
  id: string
  kind: WrapKind
  /** DEK avvolta. */
  iv: Uint8Array
  data: Uint8Array
  /** Solo per `pin`: salt PBKDF2 e costo. */
  salt?: Uint8Array
  iterations?: number
  /** Solo per `biometric`: id del credential WebAuthn e salt del PRF. */
  credentialId?: Uint8Array
  prfSalt?: Uint8Array
  /** Etichetta mostrata in Impostazioni ("iPhone di Francesco", "PIN"). */
  label: string
  createdAt: number
  lastUsedAt?: number
}

interface ArchivioDB extends DBSchema {
  auth: { key: string; value: WrappedKeyRecord }
  documents: { key: string; value: EncryptedRecord; indexes: { updatedAt: number } }
  profiles: { key: string; value: EncryptedRecord }
  /** Binari dei documenti (immagini/PDF), un record per faccia. */
  assets: { key: string; value: EncryptedRecord }
  /** Impostazioni e altri stati applicativi, cifrati. Chiavi note: `settings`. */
  appState: { key: string; value: EncryptedRecord }
}

let dbPromise: Promise<IDBPDatabase<ArchivioDB>> | null = null

export function db(): Promise<IDBPDatabase<ArchivioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ArchivioDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('auth', { keyPath: 'id' })
        const docs = database.createObjectStore('documents', { keyPath: 'id' })
        docs.createIndex('updatedAt', 'updatedAt')
        database.createObjectStore('profiles', { keyPath: 'id' })
        database.createObjectStore('assets', { keyPath: 'id' })
        database.createObjectStore('appState', { keyPath: 'id' })
      },
      blocked() {
        console.warn('[archivio] un\'altra scheda blocca l\'aggiornamento del database')
      },
    })
  }
  return dbPromise
}

/* ------------------------------- auth ------------------------------- */

export async function listWrappedKeys(): Promise<WrappedKeyRecord[]> {
  return (await db()).getAll('auth')
}

export async function putWrappedKey(rec: WrappedKeyRecord): Promise<void> {
  await (await db()).put('auth', rec)
}

export async function deleteWrappedKey(id: string): Promise<void> {
  await (await db()).delete('auth', id)
}

export async function isInitialized(): Promise<boolean> {
  return (await (await db()).count('auth')) > 0
}

/* --------------------------- record cifrati -------------------------- */

type EncStore = 'documents' | 'profiles' | 'assets' | 'appState'

export async function putEncrypted(
  store: EncStore,
  id: string,
  env: Envelope,
  updatedAt = Date.now(),
): Promise<void> {
  await (await db()).put(store, { id, iv: env.iv, data: env.data, updatedAt })
}

export async function getEncrypted(store: EncStore, id: string): Promise<EncryptedRecord | undefined> {
  return (await db()).get(store, id)
}

export async function getAllEncrypted(store: EncStore): Promise<EncryptedRecord[]> {
  return (await db()).getAll(store)
}

export async function deleteEncrypted(store: EncStore, id: string): Promise<void> {
  await (await db()).delete(store, id)
}

export async function deleteMany(store: EncStore, ids: string[]): Promise<void> {
  const tx = (await db()).transaction(store, 'readwrite')
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
}

/** Cancellazione totale del caveau: irreversibile. */
export async function wipeEverything(): Promise<void> {
  const database = await db()
  const stores: (EncStore | 'auth')[] = ['auth', 'documents', 'profiles', 'assets', 'appState']
  const tx = database.transaction(stores, 'readwrite')
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done])
}

/** Spazio occupato, per la sezione Impostazioni. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

/**
 * Chiede al browser di rendere persistente lo storage, così IndexedDB non viene
 * ripulito automaticamente sotto pressione di spazio. Senza questa richiesta i
 * documenti potrebbero essere eliminati dal browser.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
