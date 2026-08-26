/**
 * Schermata di blocco.
 *
 * Se la biometria è configurata parte da sola al primo ingresso: sull'iPhone il
 * Face ID si attiva mentre l'utente sta ancora guardando lo schermo, quindi
 * l'apertura sembra istantanea. Il PIN resta a un tap di distanza.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { archivio } from '../lib/archivio'
import { BiometricCancelledError } from '../lib/webauthn'
import { WrongPinError } from '../lib/archivio'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { PinPad } from './PinPad'

export function LockScreen() {
  const { snapshot } = useArchivio()
  const [mode, setMode] = useState<'idle' | 'biometric' | 'pin'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const autoTried = useRef(false)

  const hasBiometric = snapshot.methods.some((m) => m.kind === 'biometric')
  const hasPin = snapshot.methods.some((m) => m.kind === 'pin')

  const unlockBiometric = useCallback(async () => {
    setError(null)
    setMode('biometric')
    try {
      await archivio.unlockWithBiometric()
    } catch (err) {
      if (err instanceof BiometricCancelledError) {
        setMode(hasPin ? 'pin' : 'idle')
        return
      }
      setError(err instanceof Error ? err.message : 'Sblocco non riuscito.')
      setMode(hasPin ? 'pin' : 'idle')
      archivio.clearError()
    }
  }, [hasPin])

  // Un solo tentativo automatico per montaggio: insistere sarebbe fastidioso.
  useEffect(() => {
    if (autoTried.current) return
    autoTried.current = true
    void (async () => {
      if (await archivio.biometricAvailable()) void unlockBiometric()
      else if (hasPin) setMode('pin')
    })()
  }, [unlockBiometric, hasPin])

  async function unlockPin(pin: string) {
    setBusy(true)
    setError(null)
    try {
      await archivio.unlockWithPin(pin)
    } catch (err) {
      setError(
        err instanceof WrongPinError || err instanceof Error
          ? err.message
          : 'Sblocco non riuscito.',
      )
      archivio.clearError()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-screen">
      <span
        className="lock-shield"
        data-state={mode === 'biometric' ? 'authenticating' : error ? 'error' : 'idle'}
      >
        <Icon name={error ? 'alert' : mode === 'biometric' ? 'fingerprint' : 'lock'} size={44} />
      </span>

      <div className="stack-sm">
        <h1 className="lock-title">Caveau bloccato</h1>
        <p className="lock-subtitle">
          {mode === 'biometric'
            ? 'Autenticati per aprire i tuoi documenti.'
            : 'Serve la tua identità per aprire i documenti cifrati su questo dispositivo.'}
        </p>
      </div>

      {mode === 'pin' ? (
        <PinPad onSubmit={unlockPin} busy={busy} error={error} minLength={4} />
      ) : (
        <div className="lock-actions">
          {error && (
            <p className="form-error">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </p>
          )}

          {hasBiometric && (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={unlockBiometric}
              disabled={mode === 'biometric'}
            >
              <Icon name="fingerprint" size={20} />
              {mode === 'biometric' ? 'In attesa…' : 'Sblocca con la biometria'}
            </button>
          )}

          {hasPin && (
            <button
              type="button"
              className="btn btn-secondary btn-lg btn-block"
              onClick={() => {
                setError(null)
                setMode('pin')
              }}
            >
              <Icon name="keypad" size={19} />
              Inserisci il PIN
            </button>
          )}
        </div>
      )}

      {mode === 'pin' && hasBiometric && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={unlockBiometric}>
          <Icon name="fingerprint" size={17} />
          Usa la biometria
        </button>
      )}

      <p className="dim" style={{ fontSize: 'var(--text-xs)', maxWidth: '30ch' }}>
        I dati restano cifrati sul dispositivo. Nessuna copia viene inviata altrove.
      </p>

      <p className="lock-credit">Realizzato da Francesco Laurenzi</p>
    </div>
  )
}
