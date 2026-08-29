/**
 * Contesto React attorno al servizio `archivio`.
 *
 * Espone lo snapshot dello stato, le azioni, i toast e — soprattutto — il
 * "gate" di riconferma: una funzione `requireAuth()` che apre la richiesta
 * biometrica (o il PIN) e risolve solo quando l'utente si è autenticato.
 * Ogni apertura o condivisione di documento passa da lì.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { archivio, type ArchivioSnapshot } from '../lib/archivio'
import { terminateOcr } from '../lib/ocr'
import { DEFAULT_SETTINGS } from '../types'

/* --------------------------------- toast --------------------------------- */

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

/* --------------------------- richiesta di conferma ------------------------ */

export interface AuthRequest {
  reason: string
  resolve: (ok: boolean) => void
}

interface ArchivioContextValue {
  snapshot: ArchivioSnapshot
  toasts: Toast[]
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  /** Richiesta di riconferma attualmente aperta, gestita da `AuthGate`. */
  authRequest: AuthRequest | null
  /**
   * Chiede la riconferma d'identità. Restituisce `true` se l'utente si è
   * autenticato. Se le riconferme sono disattivate nelle impostazioni, o se
   * l'utente si è autenticato pochi secondi prima, passa senza chiedere nulla.
   */
  requireAuth: (reason: string) => Promise<boolean>
  /** Registra attività dell'utente, per rimandare il blocco automatico. */
  touch: () => void
}

const ArchivioContext = createContext<ArchivioContextValue | null>(null)

const EMPTY: ArchivioSnapshot = {
  status: 'loading',
  documents: [],
  profiles: [],
  settings: DEFAULT_SETTINGS,
  methods: [],
  error: null,
  storagePersisted: false,
  pendingBackupCount: 0,
}

export function ArchivioProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ArchivioSnapshot>(EMPTY)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [authRequest, setAuthRequest] = useState<AuthRequest | null>(null)
  const lastActivity = useRef(Date.now())
  const toastId = useRef(0)

  useEffect(() => {
    const unsubscribe = archivio.subscribe(setSnapshot)
    void archivio.bootstrap()
    return unsubscribe
  }, [])

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, message, kind }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 3600)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const touch = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  /* ------------------------------ auto-lock ------------------------------ */

  const settings = snapshot.settings
  const unlocked = snapshot.status === 'unlocked'

  useEffect(() => {
    if (!unlocked) return
    const events: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
      'focus',
    ]
    const onActivity = () => {
      lastActivity.current = Date.now()
    }
    for (const event of events) window.addEventListener(event, onActivity, { passive: true })

    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastActivity.current
      if (idleMs >= settings.autoLockMinutes * 60_000) {
        archivio.lock()
        void terminateOcr()
      }
    }, 5_000)

    return () => {
      for (const event of events) window.removeEventListener(event, onActivity)
      window.clearInterval(timer)
    }
  }, [unlocked, settings.autoLockMinutes])

  const hiddenAt = useRef<number | null>(null)

  // Uscire dall'app la richiude: nascondere la scheda è già un motivo per bloccare
  // se l'inattività supera il timeout, e la chiusura vera e propria azzera la DEK.
  useEffect(() => {
    if (!unlocked) return
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
      } else if (hiddenAt.current) {
        const away = Date.now() - hiddenAt.current
        hiddenAt.current = null
        // Tornare dopo più di mezzo timeout richiude: il telefono in tasca non
        // deve restare un caveau aperto.
        if (away >= Math.min(settings.autoLockMinutes * 60_000, 60_000)) {
          archivio.lock()
          void terminateOcr()
        } else {
          lastActivity.current = Date.now()
        }
      }
    }
    const onUnload = () => archivio.lock()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [unlocked, settings.autoLockMinutes])

  /* --------------------------- gate di riconferma ------------------------ */

  const requireAuth = useCallback(
    (reason: string): Promise<boolean> => {
      if (!archivio.isUnlocked()) return Promise.resolve(false)
      if (!archivio.snapshot().settings.requireAuthPerDocument) return Promise.resolve(true)
      // Una raffica di azioni consecutive non deve diventare una raffica di Face ID.
      if (archivio.recentlyVerified(20)) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        setAuthRequest({
          reason,
          resolve: (ok) => {
            setAuthRequest(null)
            lastActivity.current = Date.now()
            resolve(ok)
          },
        })
      })
    },
    [],
  )

  const value = useMemo<ArchivioContextValue>(
    () => ({ snapshot, toasts, toast, dismissToast, authRequest, requireAuth, touch }),
    [snapshot, toasts, toast, dismissToast, authRequest, requireAuth, touch],
  )

  return <ArchivioContext.Provider value={value}>{children}</ArchivioContext.Provider>
}

export function useArchivio(): ArchivioContextValue {
  const context = useContext(ArchivioContext)
  if (!context) throw new Error('useArchivio deve essere usato dentro ArchivioProvider.')
  return context
}
