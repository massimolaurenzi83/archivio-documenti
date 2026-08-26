/**
 * Acquisizione da fotocamera a schermo intero.
 *
 * Mostra una mascherina con le proporzioni di una carta ID-1 (85,6 × 54 mm) per
 * aiutare a inquadrare il documento: un'immagine ben inquadrata migliora l'OCR
 * più di qualsiasi elaborazione successiva.
 *
 * Lo scatto viene fatto alla risoluzione nativa del flusso video, non a quella
 * dell'elemento sullo schermo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { canvasToBlob } from '../lib/pdf'
import { Icon } from './Icon'

export interface CameraCaptureProps {
  /** Etichetta della faccia che si sta acquisendo. */
  sideLabel: string
  onCapture: (image: Blob) => void
  onCancel: () => void
}

export function CameraCapture({ sideLabel, onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Questo browser non consente l’accesso alla fotocamera.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        stop()
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setReady(true)
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Permesso negato: autorizza la fotocamera nelle impostazioni del browser.'
            : name === 'NotFoundError'
              ? 'Nessuna fotocamera disponibile su questo dispositivo.'
              : 'Non è stato possibile avviare la fotocamera.',
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [facing, stop])

  // Alla chiusura il flusso video va spento: la spia della fotocamera accesa a
  // vuoto è inaccettabile in un'app di questo tipo.
  useEffect(() => stop, [stop])

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url)
    }
  }, [shot])

  async function takeShot() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94)
    setShot({ blob, url: URL.createObjectURL(blob) })
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={`Scatta ${sideLabel}`}>
      <div className="camera-stage">
        {shot ? (
          <img src={shot.url} alt={`Anteprima ${sideLabel}`} />
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="camera-guide">
              <div className="camera-guide-frame" />
            </div>
          </>
        )}

        {error ? (
          <p className="camera-hint">{error}</p>
        ) : (
          !shot && (
            <p className="camera-hint">
              {sideLabel}: riempi la cornice, evita riflessi e ombre sul documento.
            </p>
          )
        )}
      </div>

      <div className="camera-bar">
        {shot ? (
          <>
            <button
              type="button"
              className="camera-text-btn"
              onClick={() => {
                URL.revokeObjectURL(shot.url)
                setShot(null)
              }}
            >
              Riprova
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                stop()
                onCapture(shot.blob)
              }}
            >
              <Icon name="check" size={18} />
              Usa questa foto
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="camera-text-btn"
              onClick={() => {
                stop()
                onCancel()
              }}
            >
              Annulla
            </button>
            <button
              type="button"
              className="camera-shutter"
              aria-label="Scatta"
              disabled={!ready}
              onClick={takeShot}
            />
            <button
              type="button"
              className="camera-text-btn"
              aria-label="Cambia fotocamera"
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              <Icon name="refresh" size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
