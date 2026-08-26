/** Punto di ingresso: monta l'app e registra il service worker della PWA. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { ArchivioProvider } from './state/ArchivioProvider'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root non trovato.')

createRoot(container).render(
  <StrictMode>
    <ArchivioProvider>
      <App />
    </ArchivioProvider>
  </StrictMode>,
)

// L'aggiornamento è silenzioso: la versione nuova entra in vigore al riavvio
// successivo, senza interrompere una sessione di lavoro sul caveau.
registerSW({ immediate: true })
