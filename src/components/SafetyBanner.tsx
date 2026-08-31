/**
 * Avvisi sulla sopravvivenza dell'archivio.
 *
 * Questa app non ha un server: se il browser cancella i suoi dati, non esiste
 * altra copia al mondo. È accaduto davvero, ed è il motivo per cui questi due
 * avvisi stanno in dashboard e non sepolti nelle impostazioni.
 *
 * Compaiono solo quando servono. Un avviso permanente si impara a ignorare in
 * una settimana, e allora tanto vale non averlo.
 */
import { useState } from 'react'
import { archivio } from '../lib/archivio'
import { backupFilename, deliverBackup, exportBackup } from '../lib/backup'
import { requestPersistentStorage } from '../lib/db'
import { formatBytes, formatTimestamp } from '../lib/format'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { Spinner } from './ui'

export function SafetyBanner({ onOpenBackup }: { onOpenBackup: () => void }) {
  const { snapshot, requireAuth, toast } = useArchivio()
  const [busy, setBusy] = useState(false)

  const { storagePersisted, pendingBackupCount, settings, documents } = snapshot
  const passphrase = settings.backupPassphrase
  const mostraBackup = documents.length > 0 && pendingBackupCount > 0

  /*
   * Dove l'API non esiste (Safari su iOS) non c'è nulla da attivare, e mostrare
   * un allarme che nessun pulsante può spegnere insegna solo a ignorarlo.
   */
  const puoChiedereProtezione = typeof navigator.storage?.persist === 'function'
  const mostraStorage = puoChiedereProtezione && !storagePersisted

  if (!mostraStorage && !mostraBackup) return null

  async function proteggi() {
    const ok = await requestPersistentStorage()
    if (ok) {
      toast(
        'Protetto dalla cancellazione automatica. Resta però esposto a «Cancella dati di navigazione»: per quella serve un backup.',
        'success',
      )
      return
    }
    toast(
      'Il browser non ha concesso la protezione. Installa l’app sulla schermata iniziale e riprova: di norma la concede alle app installate.',
      'info',
    )
  }

  /**
   * Backup con un tocco, riusando la passphrase dell'ultima volta.
   *
   * Senza questa scorciatoia il backup resta un modulo da compilare, e un
   * modulo da compilare non lo si fa mai — che è esattamente come si perdono
   * i documenti.
   */
  async function backupRapido() {
    if (!passphrase) {
      onOpenBackup()
      return
    }
    const ok = await requireAuth('Aggiorna il backup del caveau.')
    if (!ok) return
    setBusy(true)
    try {
      const blob = await exportBackup(passphrase)
      const filename = backupFilename()
      const esito = await deliverBackup(blob, filename)
      await archivio.recordBackup(passphrase)
      toast(
        esito === 'shared'
          ? `Backup inviato (${formatBytes(blob.size)}).`
          : `Backup salvato tra i file scaricati: ${filename} (${formatBytes(blob.size)}).`,
        'success',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backup non riuscito.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stack-sm">
      {mostraStorage && (
        <div className="safety-card safety-card-danger">
          <Icon name="alert" size={20} />
          <div className="grow">
            <div className="safety-title">Il browser può cancellare l’archivio</div>
            <p className="safety-text">
              Finché lo spazio di questo sito non è marcato come persistente, il telefono può
              eliminarlo senza preavviso quando ha bisogno di memoria. Non esiste altra copia.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={proteggi}>
              <Icon name="shield-check" size={15} />
              Proteggi adesso
            </button>
          </div>
        </div>
      )}

      {mostraBackup && (
        <div className="safety-card safety-card-warning">
          <Icon name="upload" size={20} />
          <div className="grow">
            <div className="safety-title">
              {pendingBackupCount === 1
                ? '1 documento non è in nessun backup'
                : `${pendingBackupCount} documenti non sono in nessun backup`}
            </div>
            <p className="safety-text">
              {settings.lastBackupAt
                ? `Ultimo backup: ${formatTimestamp(settings.lastBackupAt)}.`
                : 'Non hai ancora mai creato un backup. Senza, basta un «cancella dati di navigazione» o un telefono smarrito per perdere tutto senza rimedio.'}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={backupRapido}
              disabled={busy}
            >
              {busy ? (
                <Spinner label="Creazione…" />
              ) : (
                <>
                  <Icon name="download" size={15} />
                  {passphrase ? 'Aggiorna il backup' : 'Crea il primo backup'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
