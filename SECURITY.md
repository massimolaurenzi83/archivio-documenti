# Modello di sicurezza

Questo documento descrive **come** i dati sono protetti e, soprattutto, **da cosa
non** sono protetti. Serve a chi vuole capire se fidarsi dell'app, e a chi vuole
modificarla senza indebolirla per sbaglio.

## Le chiavi

```
                 ┌──────────────────────────────┐
   biometria ───▶│ PRF WebAuthn → HKDF → KEK-bio│──┐
                 └──────────────────────────────┘  │   ┌─────────────┐
                                                   ├──▶│ DEK avvolta │──▶ IndexedDB
                 ┌──────────────────────────────┐  │   └─────────────┘
   PIN ─────────▶│ PBKDF2-SHA256 650k → KEK-pin │──┘
                 └──────────────────────────────┘

   DEK (AES-GCM 256) ──▶ cifra ogni documento, ogni immagine, ogni impostazione
```

- La **DEK** (Data Encryption Key) è generata casualmente al primo avvio. È
  l'unica chiave che cifra i dati.
- La DEK non è mai salvata in chiaro. Viene *avvolta* (cifrata) da una o più
  **KEK**, una per ogni metodo di sblocco configurato.
- La KEK biometrica deriva dall'output dell'estensione **PRF** di WebAuthn: 32
  byte deterministici che l'autenticatore produce solo dopo la verifica
  dell'utente, passati per HKDF-SHA256. Il segreto non lascia il Secure Enclave
  in forma riutilizzabile.
- La KEK da PIN deriva con PBKDF2-SHA256, 650.000 iterazioni, salt casuale di 16
  byte per installazione.
- A caveau aperto la DEK vive **solo in memoria**. Il blocco (manuale, per
  inattività, all'uscita dall'app) la dimentica.

## Cosa c'è su disco

In IndexedDB, negli store `documents`, `profiles`, `assets` e `appState`, ogni
record ha esattamente tre campi: la chiave primaria (un UUID casuale), l'IV e il
testo cifrato. **Non** sono in chiaro: titoli, categorie, nomi dei file, date,
dimensioni, nomi dei profili.

Nello store `auth` sono in chiaro solo parametri pubblici — salt PBKDF2, numero
di iterazioni, id del credential WebAuthn, salt del PRF — più la DEK avvolta.
Nessuno di questi rivela contenuti né consente di ricavare la DEK.

## Riconferma dell'identità

Con l'impostazione attiva (predefinita), servono biometria o PIN di nuovo prima
di: aprire un documento, mostrare una password in chiaro, copiarla, condividere
un file o un dato, esportare o importare un backup, cancellare l'archivio.

Per non trasformare l'uso normale in una raffica di richieste, una verifica
riuscita vale **20 secondi**. È un compromesso deliberato: sotto quella soglia
l'app diventa inusabile e l'utente disattiva la protezione, che è peggio.

Nell'elenco documenti le miniature mostrano l'icona della categoria, non la
scansione: sfogliare la lista non richiede né espone il contenuto reale.

## Il file di backup

Formato `.archbk`: intestazione in chiaro con i parametri KDF, poi un unico
blocco AES-GCM che contiene metadati e binari.

La passphrase del backup è **indipendente** dal PIN e non è derivabile dalla
biometria. Non è una scomodità evitabile: la chiave biometrica è vincolata al
dispositivo per costruzione, quindi un backup che dipendesse da essa sarebbe
impossibile da ripristinare altrove.

## Cosa questo modello *non* protegge

Va detto con chiarezza:

- **Dispositivo compromesso.** Se il sistema operativo o il browser sono
  compromessi (malware, estensione ostile, keylogger), un'app web non può
  difendersi: mentre l'archivio è aperto la DEK è in memoria.
- **Sblocco del dispositivo da parte di altri.** Se qualcuno conosce il codice
  del tuo telefono e il suo volto o dito è registrato tra i biometrici del
  dispositivo, per l'app è indistinguibile da te.
- **Analisi dei metadati locali.** Il numero di record e i timestamp di modifica
  sono visibili a chi ha accesso al filesystem: rivelano *quanti* documenti hai e
  *quando* li hai toccati, non quali.
- **Cancellazione dei dati da parte del browser.** Senza archiviazione
  persistente concessa (Impostazioni → Attiva) un browser sotto pressione di
  spazio può eliminare IndexedDB. Il backup è l'unica difesa.
- **PIN debole.** Quattro cifre restano quattro cifre: PBKDF2 rallenta un
  attacco, non lo rende impossibile per chi ha copiato il database. Con dati
  davvero sensibili, usa una password alfanumerica.
- **Screenshot e appunti.** Quando copi un codice fiscale o condividi
  un'immagine, quel dato entra negli appunti o nell'app di destinazione, fuori
  dal perimetro di questa applicazione.

## Se trovi una vulnerabilità

Apri una issue senza includere dati reali, oppure scrivi in privato al
proprietario del repository. Non pubblicare exploit funzionanti prima che sia
disponibile una correzione.
