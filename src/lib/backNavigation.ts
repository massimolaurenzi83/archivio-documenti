/**
 * Tasto «indietro» di Android (e gesto di scorrimento dal bordo).
 *
 * Il problema da risolvere: in un'app installata il gesto indietro agisce sulla
 * cronologia del browser, e un'app a schermata unica non ne ha. Senza
 * intervento, ogni indietro esce dall'applicazione — anche quando sullo schermo
 * c'è un foglio aperto o ci si trova in una scheda diversa dalla Home.
 *
 * Come funziona qui: si tiene **una sola** voce di cronologia in più, una
 * sentinella, finché esiste qualcosa da cui tornare indietro. Quando il gesto
 * la consuma, si chiude il livello più interno e, se ne restano altri, la
 * sentinella viene rimessa.
 *
 * Il primo tentativo faceva gestire la cronologia a ogni singolo foglio, che
 * aggiungeva e toglieva la propria voce. Con più fogli aperti e con le
 * chiusure automatiche (blocco del caveau) le rimozioni si accavallavano e
 * finivano per consumare anche la voce iniziale dell'app: risultato, il gesto
 * indietro usciva. Una sentinella sola non può sbilanciarsi.
 *
 * A Home, senza nulla di aperto, l'indietro esce dall'app: è il comportamento
 * che Android si aspetta da una schermata di primo livello.
 */
import { useEffect, useRef } from 'react'

interface Handler {
  run: () => void
}

/** Livelli aperti, dal più esterno al più interno. L'ultimo è quello da chiudere. */
let handlers: Handler[] = []
let sentinelPushed = false
/** La prossima uscita dalla cronologia l'abbiamo chiesta noi: va ignorata. */
let ignoreNextPop = false

function sync(): void {
  if (typeof window === 'undefined') return
  const serve = handlers.length > 0
  if (serve && !sentinelPushed) {
    window.history.pushState({ archivioBack: true }, '')
    sentinelPushed = true
  } else if (!serve && sentinelPushed) {
    sentinelPushed = false
    ignoreNextPop = true
    window.history.back()
  }
}

function onPop(): void {
  if (ignoreNextPop) {
    ignoreNextPop = false
    return
  }
  // La sentinella è stata consumata dal gesto dell'utente.
  sentinelPushed = false
  const top = handlers[handlers.length - 1]
  if (top) {
    // Va tolto *prima* di eseguirlo: la chiusura provoca uno smontaggio che
    // rientrerebbe qui dentro trovando la lista non ancora aggiornata.
    handlers = handlers.filter((h) => h !== top)
    top.run()
  }
  sync()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', onPop)
}

/**
 * Registra un livello da cui il gesto indietro deve tornare.
 *
 * @param active se il livello è aperto adesso
 * @param onBack cosa fare quando l'utente torna indietro (chiudere il foglio,
 *               tornare alla Home…)
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  // La funzione arriva spesso anonima e cambia a ogni render: tenerla in un
  // riferimento evita di registrare e togliere il livello di continuo.
  const ref = useRef(onBack)
  useEffect(() => {
    ref.current = onBack
  })

  useEffect(() => {
    if (!active) return
    const handler: Handler = { run: () => ref.current() }
    handlers.push(handler)
    sync()
    return () => {
      handlers = handlers.filter((h) => h !== handler)
      sync()
    }
  }, [active])
}
