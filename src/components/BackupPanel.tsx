/**
 * Esportazione e importazione del backup cifrato.
 *
 * È l'unico modo per portare il caveau su un altro dispositivo: non esistendo
 * un server, la sincronizzazione è un file che l'utente sposta dove preferisce
 * (Drive, chiavetta, cloud personale). Il file è inutile senza la passphrase.
 */
import { useState } from 'react'
import {
  backupFilename,
  deliverBackup,
  exportBackup,
  importBackup,
  inspectBackup,
  BackupFormatError,
  BackupPassphraseError,
  type ExportProgress,
  type ImportResult,
} from '../lib/backup'
import { archivio } from '../lib/archivio'
import { formatBytes, formatTimestamp } from '../lib/format'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { Progress, Sheet, Spinner, StrengthMeter } from './ui'

/* ------------------------------ esportazione ----------------------------- */

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const { requireAuth, toast } = useArchivio()
  const [passphrase, setPassphrase] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirmValue.length > 0 && confirmValue !== passphrase
  const ready = passphrase.length >= 8 && confirmValue === passphrase && !busy

  async function run() {
    setError(null)
    const ok = await requireAuth('Esporta una copia cifrata del caveau.')
    if (!ok) return
    setBusy(true)
    try {
      const blob = await exportBackup(passphrase, setProgress)
      const filename = backupFilename()
      const esito = await deliverBackup(blob, filename)
      // Da qui in poi l'app sa quali documenti sono al sicuro e quali no.
      await archivio.recordBackup(passphrase)
      toast(
        esito === 'shared'
          ? `Backup inviato (${formatBytes(blob.size)}). Verifica che sia arrivato a destinazione.`
          : `Backup salvato tra i file scaricati: ${filename} (${formatBytes(blob.size)}).`,
        'success',
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Esportazione non riuscita.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Sheet open onClose={onClose} title="Esporta un backup">
      <p className="sheet-body">
        Il file contiene tutti i documenti, i dati estratti e i profili familiari, cifrati con la
        passphrase che scegli adesso.
      </p>

      <div className="privacy-note" style={{ marginTop: 'var(--space-4)' }}>
        <Icon name="alert" size={18} />
        <span>
          Questa passphrase non è recuperabile e non coincide con il PIN del caveau: annotala in un
          posto sicuro, senza di essa il backup è inservibile.
        </span>
      </div>

      <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
        <div className="field">
          <label className="label" htmlFor="backup-pass">
            Passphrase (almeno 8 caratteri)
          </label>
          <input
            id="backup-pass"
            className="input"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <StrengthMeter value={passphrase} />
        </div>

        <div className="field">
          <label className="label" htmlFor="backup-pass2">
            Ripeti la passphrase
          </label>
          <input
            id="backup-pass2"
            className={`input ${mismatch ? 'input-error' : ''}`}
            type="password"
            autoComplete="new-password"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
          />
          {mismatch && <span className="input-hint" style={{ color: 'var(--danger)' }}>Le due passphrase non coincidono.</span>}
        </div>

        {progress && (
          <Progress
            value={progress.phase === 'collecting' ? progress.current / Math.max(1, progress.total) : 0.95}
            label={progress.phase === 'collecting' ? 'Raccolta dei file…' : 'Cifratura…'}
          />
        )}

        {error && (
          <p className="form-error">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Annulla
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={run}>
          {busy ? <Spinner label="Creazione…" /> : 'Crea backup'}
        </button>
      </div>
    </Sheet>
  )
}

/* ------------------------------ importazione ----------------------------- */

export function ImportSheet({ onClose }: { onClose: () => void }) {
  const { requireAuth, toast } = useArchivio()
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<{ createdAt: number; documentCount: number; profileCount: number } | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function pick(selected: File) {
    setError(null)
    setFile(selected)
    setSummary(null)
    try {
      setSummary(await inspectBackup(selected))
    } catch (err) {
      setError(
        err instanceof BackupFormatError
          ? err.message
          : 'Impossibile leggere il file selezionato.',
      )
      setFile(null)
    }
  }

  async function run() {
    if (!file) return
    setError(null)
    const ok = await requireAuth('Importa un backup nel caveau.')
    if (!ok) return
    setBusy(true)
    try {
      const outcome = await importBackup(file, passphrase, { mode: 'merge' })
      setResult(outcome)
      toast('Backup importato.', 'success')
    } catch (err) {
      setError(
        err instanceof BackupPassphraseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Importazione non riuscita.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Sheet open onClose={onClose} title="Importazione completata">
        <div className="list-group">
          <div className="setting-row">
            <div className="setting-row-body">
              <div className="setting-row-title">{result.documentsAdded}</div>
              <div className="setting-row-desc">documenti aggiunti</div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row-body">
              <div className="setting-row-title">{result.documentsUpdated}</div>
              <div className="setting-row-desc">documenti aggiornati con una versione più recente</div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row-body">
              <div className="setting-row-title">{result.documentsSkipped}</div>
              <div className="setting-row-desc">già presenti e più recenti su questo dispositivo</div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row-body">
              <div className="setting-row-title">{result.profilesAdded}</div>
              <div className="setting-row-desc">profili familiari aggiunti</div>
            </div>
          </div>
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open onClose={onClose} title="Importa un backup">
      <p className="sheet-body">
        I documenti vengono uniti a quelli già presenti: a parità di documento vince la versione
        modificata più di recente.
      </p>

      <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
        <label className="choice-card" style={{ cursor: 'pointer' }}>
          <span className="choice-icon">
            <Icon name="upload" size={22} />
          </span>
          <span className="grow">
            <span className="choice-title">{file ? file.name : 'Scegli il file .archbk'}</span>
            <span className="choice-desc">
              {summary
                ? `${summary.documentCount} documenti · ${summary.profileCount} profili · creato il ${formatTimestamp(summary.createdAt)}`
                : 'Seleziona il backup salvato da questa o da un\'altra installazione.'}
            </span>
          </span>
          <input
            type="file"
            accept=".archbk,application/octet-stream"
            hidden
            onChange={(e) => {
              const selected = e.target.files?.[0]
              e.target.value = ''
              if (selected) void pick(selected)
            }}
          />
        </label>

        {file && (
          <div className="field">
            <label className="label" htmlFor="import-pass">
              Passphrase del backup
            </label>
            <input
              id="import-pass"
              className="input"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
        )}

        {error && (
          <p className="form-error">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Annulla
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!file || passphrase.length === 0 || busy}
          onClick={run}
        >
          {busy ? <Spinner label="Ripristino…" /> : 'Importa'}
        </button>
      </div>
    </Sheet>
  )
}
