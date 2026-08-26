/**
 * Condivisione verso le app native del dispositivo (WhatsApp, Mail, Telegram,
 * AirDrop…) tramite Web Share API, con ripiego su copia negli appunti.
 *
 * Nota di sicurezza: il chiamante deve avere già ottenuto la riconferma
 * biometrica/PIN. Qui non si autentica nulla, si condivide solo.
 */

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'unsupported'

export function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files })
  )
}

/** Condivide uno o più file. Se non è possibile, li salva sul dispositivo. */
export async function shareFiles(
  files: File[],
  meta: { title?: string; text?: string } = {},
): Promise<ShareOutcome> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files, title: meta.title, text: meta.text })
      return 'shared'
    } catch (err) {
      if (isAbort(err)) return 'cancelled'
      // Alcuni browser dichiarano il supporto e poi falliscono: ripieghiamo.
    }
  }
  for (const file of files) downloadBlob(file, file.name)
  return 'downloaded'
}

/** Condivide un testo (per esempio un codice fiscale) o lo copia. */
export async function shareText(text: string, title?: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, title })
      return 'shared'
    } catch (err) {
      if (isAbort(err)) return 'cancelled'
    }
  }
  return (await copyText(text)) ? 'copied' : 'unsupported'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* permesso negato o contesto non sicuro: proviamo il metodo legacy */
  }
  return legacyCopy(text)
}

/** Fallback per browser senza Clipboard API (o senza permesso). */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  return ok
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Diamo al browser il tempo di avviare il salvataggio prima di revocare.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')
}

/** Nome file leggibile e sicuro per il filesystem. */
export function safeFilename(parts: (string | undefined)[], extension: string): string {
  const base = parts
    .filter(Boolean)
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/^-|-$/g, '')
  return `${base || 'documento'}.${extension}`
}

export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  }
  return map[mime] ?? 'bin'
}
