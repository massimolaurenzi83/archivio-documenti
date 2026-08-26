/**
 * Riconferma d'identità prima di un'azione sensibile.
 *
 * Compare quando `requireAuth()` viene invocata: apertura di un documento,
 * condivisione, esportazione o importazione di un backup. Prova prima la
 * biometria (senza che l'utente debba premere nulla, se disponibile) e ripiega
 * sul PIN.
 */
import { useCallback, useEffect, useState } from 'react'
import { useArchivio } from '../state/ArchivioProvider'
import { archivio } from '../lib/archivio'
import { BiometricCancelledError } from '../lib/webauthn'
import { Icon } from './Icon'
import { PinPad } from './PinPad'
import { Sheet } from './ui'

export function AuthGate() {
  const { authRequest } = useArchivio()
  const [phase, setPhase] = useState<'idle' | 'biometric' | 'pin'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tryBiometric = useCallback(async () => {
    setError(null)
    setPhase('biometric')
    try {
      const ok = await archivio.verifyPresence()
      if (ok) {
        authRequest?.resolve(true)
        return
      }
      setPhase(archivio.hasPinMethod() ? 'pin' : 'idle')
      setError('Verifica non riuscita.')
    } catch (err) {
      if (err instanceof BiometricCancelledError) {
        setPhase(archivio.hasPinMethod() ? 'pin' : 'idle')
        setError(null)
        return
      }
      setPhase(archivio.hasPinMethod() ? 'pin' : 'idle')
      setError(err instanceof Error ? err.message : 'Verifica non riuscita.')
    }
  }, [authRequest])

  // All'apertura si parte subito con la biometria: un tap in meno ogni volta.
  useEffect(() => {
    if (!authRequest) {
      setPhase('idle')
      setError(null)
      return
    }
    let cancelled = false
    void (async () => {
      if (await archivio.biometricAvailable()) {
        if (!cancelled) void tryBiometric()
      } else {
        setPhase('pin')
      }
    })()
    return () => {
      cancelled = true
    }
    // `tryBiometric` è stabile per una data richiesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRequest])

  if (!authRequest) return null

  return (
    <Sheet open onClose={() => authRequest.resolve(false)} title="Conferma la tua identità">
      <p className="sheet-body">{authRequest.reason}</p>

      <div className="stack" style={{ marginTop: 'var(--space-5)', alignItems: 'center' }}>
        {phase === 'biometric' && (
          <>
            <div className="lock-shield" data-state="authenticating" style={{ width: 84, height: 84 }}>
              <Icon name="fingerprint" size={38} />
            </div>
            <p className="muted" style={{ textAlign: 'center' }}>
              In attesa del riconoscimento biometrico…
            </p>
            {archivio.hasPinMethod() && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('pin')}>
                Usa il PIN
              </button>
            )}
          </>
        )}

        {phase === 'pin' && (
          <PinPad
            submitLabel="Conferma"
            error={error}
            busy={busy}
            onSubmit={async (pin) => {
              setBusy(true)
              const ok = await archivio.verifyPin(pin)
              setBusy(false)
              if (ok) authRequest.resolve(true)
              else setError('PIN non corretto.')
            }}
          />
        )}

        {phase === 'idle' && (
          <>
            {error && (
              <p className="form-error">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </p>
            )}
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={tryBiometric}>
              <Icon name="fingerprint" size={19} />
              Riprova
            </button>
          </>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => authRequest.resolve(false)}
        >
          Annulla
        </button>
      </div>
    </Sheet>
  )
}
