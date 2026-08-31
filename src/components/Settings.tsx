/**
 * Impostazioni: metodi di sblocco, comportamento del caveau, backup, tema,
 * spazio occupato e cancellazione totale.
 */
import { useEffect, useState } from 'react'
import { archivio } from '../lib/archivio'
import { probeBiometricSupport } from '../lib/webauthn'
import { requestPersistentStorage, storageEstimate } from '../lib/db'
import { formatBytes, formatTimestamp } from '../lib/format'
import type { Settings as SettingsType } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { ExportSheet, ImportSheet } from './BackupPanel'
import { Icon } from './Icon'
import { PinPad } from './PinPad'
import { ConfirmSheet, Segmented, SettingRow, Sheet, Switch } from './ui'

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: '1 minuto' },
  { value: 3, label: '3 minuti' },
  { value: 5, label: '5 minuti' },
  { value: 15, label: '15 minuti' },
]

const WARNING_OPTIONS = [
  { value: 30, label: '30 giorni' },
  { value: 60, label: '60 giorni' },
  { value: 90, label: '90 giorni' },
  { value: 180, label: '6 mesi' },
]

export function SettingsView() {
  const { snapshot, toast, requireAuth } = useArchivio()
  const settings = snapshot.settings
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [biometricPossible, setBiometricPossible] = useState(false)
  const [pinSheet, setPinSheet] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void storageEstimate().then(setStorage)
    void probeBiometricSupport().then((s) => setBiometricPossible(s.webauthn && s.secureContext))
    if (navigator.storage?.persisted) void navigator.storage.persisted().then(setPersisted)
  }, [snapshot.documents.length])

  const update = (patch: Partial<SettingsType>) => archivio.updateSettings(patch)
  const hasBiometric = snapshot.methods.some((m) => m.kind === 'biometric')

  async function addBiometric() {
    setBusy(true)
    try {
      await archivio.enableBiometric()
      toast('Sblocco biometrico attivo su questo dispositivo.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Registrazione non riuscita.', 'error')
      archivio.clearError()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section>
        <div className="section-title">
          <h2>Sicurezza</h2>
        </div>

        <div className="list-group">
          {snapshot.methods.map((method) => (
            <div className="setting-row" key={method.id}>
              <span className="choice-icon" style={{ width: 36, height: 36 }}>
                <Icon name={method.kind === 'biometric' ? 'fingerprint' : 'keypad'} size={18} />
              </span>
              <div className="setting-row-body">
                <div className="setting-row-title">{method.label}</div>
                <div className="setting-row-desc">
                  {method.kind === 'biometric' ? 'Biometria' : 'PIN o password'} · aggiunto il{' '}
                  {formatTimestamp(method.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Rimuovi ${method.label}`}
                disabled={snapshot.methods.length <= 1}
                onClick={() => setRemoving(method.id)}
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
          ))}
        </div>

        <div className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
          {biometricPossible && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={addBiometric}
              disabled={busy}
            >
              <Icon name="fingerprint" size={18} />
              {hasBiometric ? 'Aggiungi un altro dispositivo biometrico' : 'Attiva lo sblocco biometrico'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => setPinSheet(true)}
          >
            <Icon name="keypad" size={18} />
            {snapshot.methods.some((m) => m.kind === 'pin') ? 'Cambia il PIN' : 'Imposta un PIN'}
          </button>
        </div>

        <div className="list-group" style={{ marginTop: 'var(--space-4)' }}>
          <SettingRow
            title="Blocco automatico"
            description="Dopo questo tempo di inattività il caveau si richiude."
          >
            <select
              className="select"
              style={{ width: 'auto', minHeight: 38 }}
              value={settings.autoLockMinutes}
              onChange={(e) => update({ autoLockMinutes: Number(e.target.value) })}
              aria-label="Tempo di blocco automatico"
            >
              {AUTO_LOCK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            title="Conferma per ogni documento"
            description="Richiedi biometria o PIN prima di aprire o condividere un documento."
          >
            <Switch
              checked={settings.requireAuthPerDocument}
              onChange={(v) => update({ requireAuthPerDocument: v })}
              label="Conferma per ogni documento"
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>Documenti</h2>
        </div>
        <div className="list-group">
          <SettingRow
            title="Avviso di scadenza"
            description="Quanto prima segnalare i documenti in scadenza."
          >
            <select
              className="select"
              style={{ width: 'auto', minHeight: 38 }}
              value={settings.expiryWarningDays}
              onChange={(e) => update({ expiryWarningDays: Number(e.target.value) })}
              aria-label="Preavviso di scadenza"
            >
              {WARNING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            title="OCR automatico"
            description="Leggi i dati subito dopo l'acquisizione, senza chiedere."
          >
            <Switch
              checked={settings.ocrAutoRun}
              onChange={(v) => update({ ocrAutoRun: v })}
              label="OCR automatico"
            />
          </SettingRow>

          <SettingRow
            title="Promemoria di calendario anonimi"
            description="Nel promemoria scrivi solo il tipo di documento, senza il titolo che gli hai dato. Utile se il calendario è condiviso."
          >
            <Switch
              checked={settings.calendarAnonymous}
              onChange={(v) => update({ calendarAnonymous: v })}
              label="Promemoria di calendario anonimi"
            />
          </SettingRow>

          <SettingRow
            title="Documenti dei familiari"
            description="Mostra la sezione con i profili di moglie, figli o genitori."
          >
            <Switch
              checked={settings.familyEnabled}
              onChange={(v) => update({ familyEnabled: v })}
              label="Documenti dei familiari"
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>Backup</h2>
        </div>
        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
          Non esistendo un server, il trasferimento su un altro dispositivo passa da un file cifrato
          che gestisci tu.
        </p>
        <div className="list-group">
          <button type="button" className="list-row" onClick={() => setExporting(true)}>
            <span className="choice-icon" style={{ width: 36, height: 36 }}>
              <Icon name="download" size={18} />
            </span>
            <span className="grow">
              <span className="list-row-title">Esporta backup cifrato</span>
              <span className="list-row-desc">Un unico file con documenti, dati e profili.</span>
            </span>
            <Icon name="chevron-right" size={17} className="dim" />
          </button>
          <button type="button" className="list-row" onClick={() => setImporting(true)}>
            <span className="choice-icon" style={{ width: 36, height: 36 }}>
              <Icon name="upload" size={18} />
            </span>
            <span className="grow">
              <span className="list-row-title">Importa backup</span>
              <span className="list-row-desc">Ripristina o sincronizza da un altro dispositivo.</span>
            </span>
            <Icon name="chevron-right" size={17} className="dim" />
          </button>
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>Aspetto</h2>
        </div>
        <div className="list-group">
          <SettingRow title="Tema">
            <Segmented
              ariaLabel="Tema"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'dark', label: 'Scuro' },
                { value: 'light', label: 'Chiaro' },
                { value: 'system', label: 'Auto' },
              ]}
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>Spazio e dati</h2>
        </div>
        <div className="list-group">
          <SettingRow
            title="Spazio occupato"
            description={
              storage
                ? `${formatBytes(storage.usage)} usati su ${formatBytes(storage.quota)} disponibili per questa app.`
                : 'Non disponibile su questo browser.'
            }
          />
          <SettingRow
            title="Versione installata"
            description={`Build ${__BUILD_ID__} (UTC). Se non corrisponde all'ultima pubblicata, chiudi e riapri l'app per aggiornarla.`}
          />
          <SettingRow
            title="Archiviazione persistente"
            description={
              persisted
                ? 'Attiva: il browser non cancellerà i documenti per liberare spazio. Non protegge però da «Cancella dati di navigazione»: quella cancella tutto, e solo un backup permette di recuperare.'
                : 'Non attiva: in caso di spazio esaurito il browser potrebbe eliminare i dati.'
            }
          >
            {!persisted && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const ok = await requestPersistentStorage()
                  setPersisted(ok)
                  toast(
                    ok ? 'Archiviazione resa persistente.' : 'Il browser ha rifiutato la richiesta.',
                    ok ? 'success' : 'error',
                  )
                }}
              >
                Attiva
              </button>
            )}
          </SettingRow>
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2 style={{ color: 'var(--danger)' }}>Zona pericolosa</h2>
        </div>
        <div className="card card-pad stack">
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            La cancellazione elimina definitivamente documenti, profili e chiavi da questo
            dispositivo. Se non hai un backup, i dati non sono più recuperabili in alcun modo.
          </p>
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => setConfirmWipe(true)}
          >
            <Icon name="trash" size={18} />
            Cancella tutto il caveau
          </button>
        </div>
      </section>

      <p className="dim" style={{ fontSize: 'var(--text-xs)', textAlign: 'center' }}>
        Archivio Documenti · nessun account, nessun server, nessuna telemetria
      </p>

      {/* ------------------------------ dialoghi ------------------------------ */}

      {pinSheet && (
        <Sheet open onClose={() => setPinSheet(false)} title="Imposta il PIN">
          <p className="sheet-body">
            Almeno 6 cifre. Sostituisce l'eventuale PIN esistente e resta valido come metodo di
            sblocco alternativo alla biometria.
          </p>
          <div style={{ marginTop: 'var(--space-5)' }}>
            <PinPad
              minLength={6}
              submitLabel="Salva PIN"
              onSubmit={async (pin) => {
                try {
                  await archivio.setPin(pin)
                  toast('PIN aggiornato.', 'success')
                  setPinSheet(false)
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Operazione non riuscita.', 'error')
                  archivio.clearError()
                }
              }}
            />
          </div>
        </Sheet>
      )}

      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}

      <ConfirmSheet
        open={removing !== null}
        title="Rimuovere questo metodo?"
        destructive
        confirmLabel="Rimuovi"
        body="Non potrai più sbloccare il caveau con questo metodo. Deve restarne almeno uno attivo."
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            if (removing) await archivio.removeMethod(removing)
            toast('Metodo rimosso.', 'success')
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Operazione non riuscita.', 'error')
            archivio.clearError()
          } finally {
            setRemoving(null)
          }
        }}
      />

      <ConfirmSheet
        open={confirmWipe}
        title="Cancellare tutto?"
        destructive
        confirmLabel="Cancella definitivamente"
        body={
          <>
            Verranno eliminati <strong>{snapshot.documents.length} documenti</strong>, tutti i
            profili e le chiavi di cifratura. Questa azione non può essere annullata.
          </>
        }
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => {
          const ok = await requireAuth('Conferma la cancellazione totale del caveau.')
          if (!ok) {
            setConfirmWipe(false)
            return
          }
          await archivio.destroyEverything()
          setConfirmWipe(false)
          toast('Caveau cancellato da questo dispositivo.', 'success')
        }}
      />
    </>
  )
}
