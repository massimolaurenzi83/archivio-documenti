/**
 * Configurazione al primo avvio.
 *
 * Tre passaggi: presentazione, scelta del metodo di sblocco, eventuale PIN di
 * riserva. La scelta resta modificabile in seguito da Impostazioni.
 */
import { useEffect, useState } from 'react'
import { archivio } from '../lib/archivio'
import { probeBiometricSupport, type BiometricSupport } from '../lib/webauthn'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { PinPad } from './PinPad'
import { StrengthMeter } from './ui'

type Step = 'intro' | 'method' | 'pin' | 'pin-confirm' | 'backup-pin'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { toast } = useArchivio()
  const [step, setStep] = useState<Step>('intro')
  const [support, setSupport] = useState<BiometricSupport | null>(null)
  const [firstPin, setFirstPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void probeBiometricSupport().then(setSupport)
  }, [])

  const biometricUsable = Boolean(support?.webauthn && support.secureContext)

  const biometricNote = !support
    ? 'Verifica del dispositivo…'
    : !support.secureContext
      ? 'Non disponibile: serve una connessione https o localhost.'
      : !support.webauthn
        ? 'Non disponibile su questo browser.'
        : support.platformAuthenticator
          ? 'Face ID, Touch ID o impronta digitale di questo dispositivo.'
          : 'Nessun sensore integrato rilevato: potresti usare una chiave di sicurezza.'

  async function startBiometric() {
    setBusy(true)
    setError(null)
    try {
      await archivio.initializeWithBiometric()
      setStep('backup-pin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrazione non riuscita.')
      archivio.clearError()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Se il caveau esiste già (biometria appena registrata) il PIN va aggiunto come
   * secondo metodo, non ricreato da zero: rigenerare la DEK cancellerebbe la
   * chiave biometrica appena creata.
   */
  async function finalizePin(pin: string) {
    setBusy(true)
    setError(null)
    try {
      if (archivio.isUnlocked()) {
        await archivio.setPin(pin)
        toast('PIN di riserva attivo.', 'success')
      } else {
        await archivio.initializeWithPin(pin)
        toast('Caveau creato su questo dispositivo.', 'success')
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impostazione del PIN non riuscita.')
      archivio.clearError()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="steps" aria-hidden="true">
        {(['intro', 'method', 'pin'] as const).map((s, i) => {
          const order = ['intro', 'method', 'pin', 'pin-confirm', 'backup-pin']
          const currentIndex = Math.min(order.indexOf(step), 2)
          return (
            <span
              key={s}
              className="step-dot"
              data-state={i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo'}
            />
          )
        })}
      </div>

      {step === 'intro' && (
        <>
          <div className="onboarding-hero">
            <span className="lock-shield">
              <Icon name="shield-check" size={44} />
            </span>
            <h1>Archivio Documenti</h1>
            <p className="onboarding-lede">
              Il caveau dei tuoi documenti, cifrato e custodito solo su questo dispositivo.
            </p>
          </div>

          <div className="stack">
            <FeatureRow
              icon="lock"
              title="Cifrato a riposo"
              text="Ogni file e ogni dato estratto è cifrato con AES-256 prima di toccare il disco."
            />
            <FeatureRow
              icon="scan"
              title="Riconoscimento a bordo"
              text="L'OCR gira sul tuo dispositivo: nessuna immagine viene mai inviata a un server."
            />
            <FeatureRow
              icon="users"
              title="Anche per la famiglia"
              text="Profili separati per i documenti di moglie, figli o genitori."
            />
          </div>

          <div className="privacy-note">
            <Icon name="shield" size={18} />
            <span>
              Questa app non ha un server. Non esiste nessun account, nessuna sincronizzazione
              automatica e nessuna telemetria.
            </span>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => setStep('method')}
          >
            Inizia
          </button>
        </>
      )}

      {step === 'method' && (
        <>
          <div className="stack-sm">
            <span className="eyebrow">Passaggio 2 di 3</span>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Come vuoi sbloccare il caveau?</h1>
            <p className="muted">
              La chiave di cifratura nasce da questa scelta. Potrai aggiungere il secondo metodo in
              qualsiasi momento.
            </p>
          </div>

          {error && (
            <p className="form-error">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </p>
          )}

          <div className="stack">
            <button
              type="button"
              className="choice-card"
              disabled={!biometricUsable || busy}
              onClick={startBiometric}
            >
              <span className="choice-icon">
                <Icon name="fingerprint" size={22} />
              </span>
              <span className="grow">
                <span className="choice-title">
                  Biometria {biometricUsable && <span className="badge badge-accent">consigliato</span>}
                </span>
                <span className="choice-desc">{biometricNote}</span>
              </span>
              <Icon name="chevron-right" size={18} />
            </button>

            <button
              type="button"
              className="choice-card"
              disabled={busy}
              onClick={() => setStep('pin')}
            >
              <span className="choice-icon">
                <Icon name="keypad" size={22} />
              </span>
              <span className="grow">
                <span className="choice-title">PIN o password</span>
                <span className="choice-desc">
                  Funziona su qualsiasi browser. Attenzione: se lo dimentichi, i documenti non sono
                  più recuperabili.
                </span>
              </span>
              <Icon name="chevron-right" size={18} />
            </button>
          </div>

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('intro')}>
            Indietro
          </button>
        </>
      )}

      {step === 'pin' && (
        <>
          <div className="stack-sm">
            <span className="eyebrow">Passaggio 3 di 3</span>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Scegli il PIN</h1>
            <p className="muted">
              {archivio.isUnlocked()
                ? 'Almeno 6 cifre. Sarà il metodo di riserva quando la biometria non è disponibile.'
                : "Almeno 6 cifre. È l'unica chiave del caveau: non esiste nessun modo di recuperarlo."}
            </p>
          </div>
          <StrengthMeter value={firstPin} />
          <PinPad
            minLength={6}
            submitLabel="Continua"
            error={error}
            onSubmit={(pin) => {
              setFirstPin(pin)
              setError(null)
              setStep('pin-confirm')
            }}
          />
        </>
      )}

      {step === 'pin-confirm' && (
        <>
          <div className="stack-sm">
            <span className="eyebrow">Conferma</span>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Ripeti il PIN</h1>
          </div>
          <PinPad
            minLength={6}
            submitLabel={archivio.isUnlocked() ? 'Salva il PIN' : 'Crea il caveau'}
            busy={busy}
            error={error}
            onSubmit={(pin) => {
              if (pin !== firstPin) {
                setError('I due valori non coincidono.')
                setStep('pin')
                return
              }
              void finalizePin(pin)
            }}
          />
        </>
      )}

      {step === 'backup-pin' && (
        <>
          <div className="onboarding-hero">
            <span className="lock-shield">
              <Icon name="check" size={40} />
            </span>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Biometria attiva</h1>
            <p className="onboarding-lede">
              Vuoi aggiungere anche un PIN di riserva? Serve se la biometria non fosse disponibile,
              per esempio aprendo il caveau da un altro browser dello stesso dispositivo.
            </p>
          </div>
          <div className="stack">
            <button
              type="button"
              className="btn btn-secondary btn-lg btn-block"
              onClick={() => setStep('pin')}
            >
              <Icon name="keypad" size={19} />
              Aggiungi un PIN di riserva
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={() => {
                toast('Caveau pronto.', 'success')
                onDone()
              }}
            >
              Vai al caveau
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function FeatureRow({
  icon,
  title,
  text,
}: {
  icon: 'lock' | 'scan' | 'users'
  title: string
  text: string
}) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}>
      <span className="choice-icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <div className="choice-title">{title}</div>
        <div className="choice-desc">{text}</div>
      </div>
    </div>
  )
}
