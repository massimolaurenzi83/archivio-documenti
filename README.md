# Archivio Documenti

Caveau digitale personale per documenti e credenziali: **cifrato, con sblocco
biometrico e OCR, interamente sul tuo dispositivo.**

Nessun server, nessun account, nessuna sincronizzazione automatica, nessuna
telemetria. Questo repository contiene **solo il codice**: quando avvii l'app, il
tuo archivio nasce vuoto sul tuo telefono o sul tuo computer e non esce da lì.

---

## Cosa fa

- **Fronte e retro** di ogni documento, acquisiti dalla fotocamera con cornice
  guida oppure scegliendo un file (immagine o PDF) già sul dispositivo.
- **Ritaglio e raddrizzamento automatici**: l'app trova il bordo del documento
  nella foto e ne corregge la prospettiva. Su una foto inclinata di 10° la
  differenza misurata è netta — 8 campi estratti invece di 4, MRZ riconosciuta
  invece che illeggibile — perché il riconoscimento della banda MRZ presuppone
  righe orizzontali. Il bordo proposto è correggibile trascinando i quattro
  angoli, e si può sempre tenere l'immagine intera.
- **Riconoscimento automatico dei dati** (OCR) eseguito sul dispositivo: nome,
  cognome, codice fiscale, numero documento, date di nascita/rilascio/scadenza,
  indirizzo. Ogni campo ha il suo pulsante *copia*, per incollare il codice
  fiscale in un messaggio senza ricopiarlo a mano.
- **Dati rapidi**: i campi che usi sempre, appuntati in dashboard e copiabili
  con un tocco. I valori restano mascherati (`RSS••••••••••62S`) fino alla
  riconferma d'identità, poi leggibili per venti secondi. Al primo avvio l'app
  propone da sé il codice fiscale del profilo principale.
- **Lettura della banda MRZ** (le righe con i `<<<` sul retro della Carta
  d'Identità Elettronica e nella pagina dati del passaporto). La MRZ ha cifre di
  controllo: quando il checksum torna, il dato è esatto anche se il resto della
  scansione è venuto male. Questi campi sono marcati come *verificati*.
- **Categorie** predefinite: carta d'identità, passaporto, tessera sanitaria,
  codice fiscale, patente, documenti generali, password/credenziali, altro.
- **Caricamento in blocco**: scegli molte immagini in una volta e l'app le
  elabora in coda — raddrizzamento, OCR, riconoscimento della categoria dal
  testo stampato (o dal formato MRZ: TD3 è un passaporto, TD1 una carta
  d'identità) e accorpamento automatico di fronte e retro consecutivi. Poi
  confermi un elenco già compilato. Serve alla prima volta, quando i documenti
  da inserire sono dieci o quindici.
- **Avvisi di scadenza** con preavviso configurabile, e **promemoria nel
  calendario** del telefono con due allarmi (60 e 7 giorni prima). Il perché di
  questo giro: una notifica push richiederebbe un server, e questa app non ne
  ha. Il calendario invece notifica in modo affidabile ed è già sul dispositivo.
  Il file `.ics` contiene solo titolo e data — mai numeri o dati estratti — e
  un'opzione lo rende anonimo (solo il tipo di documento) per chi sincronizza il
  calendario con un account condiviso.
- **Profili familiari** separati (moglie, figli, genitori), attivabili e
  disattivabili. I documenti di un familiare non compaiono mai mescolati ai tuoi.
- **Condivisione** verso le app native (WhatsApp, Mail, Telegram, AirDrop…) del
  documento intero o di un singolo dato, sempre previa nuova conferma
  dell'identità.
- **Backup cifrato** in un unico file, da salvare dove preferisci e importare su
  un altro dispositivo.
- **PWA installabile**, funzionante offline dopo il primo caricamento.

## Come funziona la sicurezza

| Elemento | Scelta implementativa |
| --- | --- |
| Cifratura | AES-GCM 256 bit via Web Crypto API, IV casuale per ogni record |
| Chiave dati (DEK) | generata casualmente, mai salvata in chiaro, viva solo in memoria a caveau aperto |
| Sblocco biometrico | WebAuthn con estensione **PRF**: la chiave che protegge la DEK nasce nel Secure Enclave del dispositivo |
| Sblocco alternativo | PIN o password, PBKDF2-SHA256 con 650.000 iterazioni e salt casuale |
| Cosa c'è su disco | solo record cifrati: né titoli, né categorie, né nomi file in chiaro |
| Blocco automatico | dopo inattività, all'uscita dall'app e alla chiusura della scheda |
| Riconferma | biometria o PIN richiesti di nuovo prima di aprire o condividere un documento |

Due conseguenze da conoscere, che derivano dall'assenza di un server:

1. **Se perdi il PIN, i documenti non sono recuperabili.** Non esiste un
   "password dimenticata": nessuno, nemmeno chi ha scritto questo codice, ha una
   copia della tua chiave.
2. **La chiave biometrica è legata al dispositivo.** Non può essere copiata su un
   altro telefono: il trasferimento passa dal file di backup, che è cifrato con
   una passphrase dedicata scelta da te al momento dell'esportazione.

Dettagli in [`SECURITY.md`](SECURITY.md).

## Avvio in locale

Serve [Node.js](https://nodejs.org) 20 o superiore.

```bash
git clone https://github.com/<tuo-utente>/archivio-documenti.git
```

```bash
cd archivio-documenti && npm install
```

```bash
npm run dev
```

L'app risponde su `http://localhost:5173`. `localhost` è considerato un contesto
sicuro dai browser, quindi **biometria e fotocamera funzionano** anche senza
certificato HTTPS.

Per la build di produzione:

```bash
npm run build && npm run preview
```

### Uso dallo smartphone

Biometria e fotocamera richiedono **https** (oppure `localhost`). Due strade:

- **GitHub Pages** — il workflow incluso pubblica l'app a ogni push sul ramo
  principale: vedi la sezione seguente.
- **Rete locale con HTTPS** — esponi il server di sviluppo con un tunnel che
  fornisca un certificato valido, oppure configura Vite con un certificato
  locale. Su `http://192.168.x.x` il browser blocca WebAuthn.

Una volta aperta l'app, installala: *Condividi → Aggiungi a Home* su iOS,
*Installa app* su Android. Da quel momento funziona offline.

## Pubblicazione su GitHub Pages

Il workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
compila e pubblica automaticamente. Una volta sola, nelle impostazioni del
repository: **Settings → Pages → Source: GitHub Actions**.

Il workflow imposta da sé la `base` corretta di Vite in funzione del nome del
repository, quindi non c'è nulla da configurare a mano.

> Anche pubblicando su Pages, i dati restano sul dispositivo di chi usa l'app:
> GitHub serve solo i file statici dell'applicazione, non vede né riceve nulla.

## Struttura del progetto

```
src/
  lib/
    crypto.ts      primitive Web Crypto: chiavi, wrapping, cifratura
    webauthn.ts    biometria e derivazione della chiave via estensione PRF
    archivio.ts    servizio centrale: stato, DEK in memoria, CRUD
    db.ts          IndexedDB — solo record cifrati
    ocr.ts         Tesseract.js locale, pre-elaborazione immagine, passata MRZ
    scan.ts        rilevamento del bordo (Sobel + Hough) e raddrizzamento
    classify.ts    categoria e faccia dal testo, accorpamento fronte/retro
    mrz.ts         parser MRZ TD1/TD2/TD3 con cifre di controllo
    extract.ts     estrazione campi da documenti italiani (con validazione CF)
    backup.ts      contenitore .archbk cifrato
    calendar.ts    promemoria iCalendar (RFC 5545) con allarmi
    pdf.ts         anteprime e rasterizzazione PDF con pdf.js
    share.ts       Web Share API e appunti
  components/      una classe CSS per componente, nessun colore letterale
  styles/
    tokens.css     design token: palette, tipografia, spazi, ombre, movimento
  state/           contesto React e gate di riconferma
scripts/
  generate-icons.mjs     icone PWA generate senza dipendenze
  prepare-ocr-assets.mjs aggiorna wasm e modello linguistico dell'OCR
public/
  tesseract/  tessdata/  pdf/   motori OCR e PDF serviti localmente
```

### Personalizzare la grafica

Palette, tipografia, raggi, ombre e durate delle animazioni stanno tutti in
[`src/styles/tokens.css`](src/styles/tokens.css). Cambiare tema significa
riscrivere quei valori: i componenti non contengono colori. Le icone sono in
[`src/components/Icon.tsx`](src/components/Icon.tsx), disegnate su griglia 24 con
le regole del set documentate in cima al file.

## Perché l'OCR pesa 16 MB

Il motore WebAssembly di Tesseract e il modello linguistico italiano sono
**inclusi nel repository** invece di essere scaricati da una CDN a runtime. È una
scelta deliberata: se l'app scaricasse il modello da un server esterno, quel
server vedrebbe *quando* stai scansionando un documento. Meglio 16 MB una volta.

Per aggiornarli:

```bash
node scripts/prepare-ocr-assets.mjs
```

## Privacy — cosa esce dal dispositivo

Niente. In esecuzione l'app non contatta alcun host esterno: nessuna CDN,
nessun font remoto, nessun servizio di analisi. Le uniche uscite di dati sono
quelle che avvii tu, esplicitamente: la condivisione verso un'altra app e il
salvataggio del file di backup.

## Compatibilità

| Browser | Biometria (PRF) | PIN | OCR | Fotocamera |
| --- | --- | --- | --- | --- |
| Chrome / Edge desktop e Android | sì | sì | sì | sì |
| Safari iOS 18+ / macOS 15+ | sì | sì | sì | sì |
| Safari precedenti | no | sì | sì | sì |
| Firefox | no | sì | sì | sì |

Dove il PRF non è disponibile l'app propone automaticamente il PIN: nessuna
funzione resta inaccessibile.

## Licenza

[MIT](LICENSE).
