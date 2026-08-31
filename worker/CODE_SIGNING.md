# Firma digitale del Property Data Worker

Stato al 31 agosto 2026: **gli installer pubblicati non sono firmati.** Verificato
leggendo la directory SECURITY dell'header PE di
`Property-Data-Worker-Setup-0.29.0.exe` scaricato da GitHub Releases: tabella dei
certificati a offset 0, dimensione 0 byte. Nessuna firma, nemmeno self-signed.

Windows mostra quindi **Editore sconosciuto** su SmartScreen e su UAC. Il valore
`CompanyName = "Listing Radar"` presente nelle risorse di versione dell'eseguibile
non è il Publisher: è un campo descrittivo che chiunque può scrivere e che
Windows non usa per identificare l'autore.

Questo documento descrive come si arriva a una release firmata. Le modifiche al
repository sono già presenti: manca solo il certificato.

---

## 1. Provider scelto

**Azure Trusted Signing**, in modalità `azure-trusted-signing`.

Motivi, nell'ordine che conta per questo repository:

- la chiave privata non esiste mai come file. Non c'è un `.pfx` da mettere in un
  secret, da copiare su un PC o da ruotare a mano. È il requisito che avevamo
  posto e nessuna altra opzione lo soddisfa davvero;
- electron-builder 26.15.3, la versione bloccata nel lockfile, supporta
  `win.azureSignOptions` in modo nativo: non serve una funzione di firma custom;
- funziona su un runner `windows-latest` di GitHub Actions con tre variabili
  d'ambiente, senza hardware, senza token USB e senza una macchina di firma sempre
  accesa;
- il timestamp RFC 3161 è incluso e attivo per impostazione predefinita;
- il costo è a consumo e basso rispetto a un certificato EV tradizionale.

Il limite da conoscere: Microsoft richiede che l'organizzazione o la persona
richiedente esista da **almeno tre anni** con documentazione verificabile. Se il
requisito non è soddisfatto, la strada alternativa è un certificato OV o EV di
una CA commerciale, usato in modalità `signtool-pfx` (per un OV su HSM cloud) o
tramite il provider della CA. Il codice in questo repository supporta già
entrambe le modalità.

### Perché non le altre opzioni

| Opzione | Perché è stata scartata |
| --- | --- |
| Certificato OV `.pfx` in GitHub Secrets | La chiave privata esiste come file e transita nel runner. Dal giugno 2023 le CA emettono comunque solo su hardware o HSM, quindi un `.pfx` esportabile non è più ottenibile da una CA pubblica. |
| Certificato EV su token USB | Reputazione SmartScreen immediata, ma la firma richiede il token fisico collegato: incompatibile con una pipeline automatica, salvo tenere un runner self-hosted acceso con il token inserito. |
| Certificato EV su HSM cloud della CA | Tecnicamente valido e automatizzabile, ma costa più di Azure, aggiunge un fornitore e richiede comunque un'integrazione specifica per CA. |
| Nessuna firma, allowlist per hash | Va rifatto a ogni release. Non risolve SmartScreen per gli altri PC. Non è una soluzione, è una deroga permanente. |

---

## 2. Prerequisiti da procurare all'esterno

Nessuno di questi passaggi è stato eseguito: vanno fatti da una persona con
potere di firma sull'identità che comparirà nel certificato.

1. **Sottoscrizione Azure** con un metodo di pagamento attivo.
2. **Trusted Signing Account** e **Certificate Profile** nella regione scelta
   (per l'Italia, `West Europe` → endpoint `https://weu.codesigning.azure.net`).
3. **Verifica dell'identità** presso Microsoft: visura, partita IVA, indirizzo e
   riferimento verificabile. Richiede giorni, non minuti.
4. **Service principal Microsoft Entra ID** con il ruolo *Trusted Signing
   Certificate Profile Signer* sul profilo. Da qui escono `AZURE_TENANT_ID`,
   `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
5. Costi ricorrenti: canone mensile del servizio più un costo per firma. La
   verifica dell'identità si rinnova periodicamente.

Per la modalità `signtool-pfx` servono invece il certificato e la sua password,
più il mezzo con cui la CA espone la chiave.

---

## 3. Nome del Publisher

Il Publisher **non si sceglie**: è il subject che la CA scrive nel certificato
dopo aver verificato l'identità. Va indicato nella forma completa, per esempio
`CN=Ragione Sociale S.r.l., O=Ragione Sociale S.r.l., L=Bitonto, C=IT`.

Vincoli da rispettare quando si compila la richiesta:

- deve corrispondere alla **ragione sociale registrata**, non al nome commerciale.
  "Listing Radar" è il nome del prodotto: può comparire come `ProductName` nelle
  risorse dell'eseguibile, ma non può essere il Publisher se non è anche la
  denominazione dell'entità verificata;
- una ditta individuale o una persona fisica può ottenere un certificato, e in
  quel caso il Publisher è il **nome della persona**, non un marchio;
- un nome commerciale diverso dalla ragione sociale richiede alla CA una prova
  del suo uso legittimo (DBA), e non tutte le CA lo accettano;
- Azure Trusted Signing non permette nomi arbitrari: il subject viene generato dal
  profilo verificato.

Questo documento **non propone un nome**: va deciso da chi firma il contratto e
poi copiato identico nel secret `WORKER_SIGNING_PUBLISHER`, perché la pipeline
confronta il subject della firma con quel valore e fallisce se differiscono.

---

## 4. Secret richiesti su GitHub

Da configurare in *Settings → Secrets and variables → Actions*. Nessuno di questi
valori va scritto nel repository, in un file `.env` committato o in un log.

| Secret | Contenuto | Modalità |
| --- | --- | --- |
| `WORKER_SIGNING_PUBLISHER` | Subject atteso, identico a quello del certificato | entrambe |
| `WORKER_SIGNING_ENDPOINT` | Endpoint del servizio, es. `https://weu.codesigning.azure.net` | azure |
| `WORKER_SIGNING_ACCOUNT` | Nome del Trusted Signing Account | azure |
| `WORKER_SIGNING_CERT_PROFILE` | Nome del Certificate Profile | azure |
| `AZURE_TENANT_ID` | Tenant del service principal | azure |
| `AZURE_CLIENT_ID` | Application ID del service principal | azure |
| `AZURE_CLIENT_SECRET` | Segreto del service principal | azure |
| `WIN_CSC_LINK` | Certificato `.pfx` in base64 oppure percorso | signtool |
| `WIN_CSC_KEY_PASSWORD` | Password del certificato | signtool |

`WORKER_SIGNING_TIMESTAMP_URL` è facoltativo e serve solo per sostituire il
timestamp server predefinito.

---

## 5. Configurazione electron-builder

Verificata contro **electron-builder 26.15.3**, la versione bloccata in
`worker/package-lock.json`, leggendo direttamente
`app-builder-lib/out/options/winOptions.d.ts`.

Nella 26 le opzioni di firma sono state spostate. Le chiavi che si trovano nelle
guide più vecchie **non esistono più**:

| Forma vecchia (24/25) | Forma corretta nella 26 |
| --- | --- |
| `win.certificateFile` | `win.signtoolOptions.certificateFile` |
| `win.certificateSubjectName` | `win.signtoolOptions.certificateSubjectName` |
| `win.publisherName` | `win.signtoolOptions.publisherName` o `win.azureSignOptions.publisherName` |
| `win.rfc3161TimeStampServer` | `win.signtoolOptions.rfc3161TimeStampServer` |
| `win.signingHashAlgorithms` | `win.signtoolOptions.signingHashAlgorithms` |

Lo schema di `WindowsConfiguration` ha `additionalProperties: false`: usare la
forma vecchia non produce una build silenziosamente non firmata, ma un errore di
configurazione. È comunque un errore da evitare, perché costa una build.

Due comportamenti predefiniti che vanno corretti esplicitamente e che il codice
in `scripts/windows-signing.ts` già imposta:

- `shouldSignFile` firma **solo i `.exe`**. Le DLL e i moduli nativi restano non
  firmati se non si dichiara `signExts`. Impostiamo `[".dll", ".node"]`;
- senza `forceCodeSigning: true`, una firma fallita produce un warning e una build
  **che riesce comunque**, con artefatti non firmati. Lo impostiamo sempre nelle
  modalità firmate.

La configurazione non è scritta a mano in `package.json`: `build.win` resta
quello della build non firmata, e `scripts/build-signed-installer.ts` vi fonde il
blocco di firma prima di passare la configurazione completa a electron-builder con
`--config`. Così la build locale non firmata continua a funzionare senza
certificato, e non esistono due configurazioni da tenere allineate.

Cosa viene firmato con questa configurazione:

- `Property Data Worker.exe` nell'app impacchettata;
- l'installer NSIS `Property Data Worker Setup X.Y.Z.exe`;
- l'uninstaller, che electron-builder firma prima di incorporarlo;
- le DLL e i moduli nativi, grazie a `signExts`.

---

## 6. Procedura di release

1. incrementare la versione in `worker/package.json`;
2. eseguire `npm test` nel worker;
3. avviare a mano il workflow **Property Data Worker Release** scegliendo
   `signing_mode: azure-trusted-signing` e lasciando `publish: false`;
4. controllare l'esito del passo *Verifica firma* e scaricare l'artifact;
5. provare l'installer su una macchina pulita: il dialogo UAC deve mostrare il
   Publisher, non "Editore sconosciuto";
6. rilanciare il workflow con `publish: true` per pubblicare la release.

La pubblicazione resta governata da `scripts/publish-update.mjs`, che rifiuta di
procedere se il worktree non è pulito, se `HEAD` non coincide con il branch di
default remoto o se un asset risulta incompleto. Non è stato modificato.

In locale la build firmata è possibile solo da Windows con le variabili in
ambiente:

```powershell
npm run desktop:build:signed
npm run desktop:verify-signature -- --require-windows --publisher="CN=..." "release/Property Data Worker Setup 0.30.0.exe"
```

---

## 7. Verifica della firma

`scripts/verify-installer-signature.ts` lavora su due livelli.

Il primo legge la directory SECURITY dell'header PE e funziona ovunque, anche su
Linux e nei test: risponde in modo deterministico alla domanda "questo file
contiene una firma". È il controllo che ha dimostrato che l'installer attuale non
è firmato.

Il secondo gira solo su Windows e usa `Get-AuthenticodeSignature`, che è l'unica
fonte affidabile per catena, scadenza e timestamp. Lo script fallisce se:

- non esiste una tabella dei certificati con una entry `PKCS_SIGNED_DATA`;
- lo stato della firma non è `Valid`;
- manca il certificato firmatario;
- manca il timestamp RFC 3161;
- il certificato risulta scaduto;
- il subject non coincide con `--publisher`.

Con `--require-windows` lo script si rifiuta di girare fuori da Windows, invece di
far passare una verifica parziale per una verifica completa. Il workflow lo invoca
sempre con quel flag.

---

## 8. Effetti sull'aggiornamento automatico

L'updater del worker è **custom** (`src/desktop/updater.ts`): non usa
electron-updater. Scarica le parti `.bin` dalla release, le ricompone, confronta
lo SHA-256 con `property-worker-manifest.json` e avvia l'installer. Non esistono
`latest.yml` né blockmap, e l'opzione `win.verifyUpdateCodeSignature` di
electron-builder non ha alcun effetto qui, perché riguarda solo electron-updater.

Conseguenze concrete:

- **un worker non firmato si aggiorna a una versione firmata.** L'updater verifica
  hash e dimensione, non il Publisher, quindi la transizione non richiede nulla di
  speciale;
- **la firma cambia lo SHA-256 dell'installer**, perché viene incorporata nel PE.
  Non è un problema: `publish-update.mjs` calcola hash e parti *dopo* la build,
  quindi dal binario già firmato. L'ordine attuale è corretto e non va toccato;
- **non ci sono vincoli sul cambio di Publisher o di certificato** lato updater,
  proprio perché non lo verifica. Un rinnovo del certificato non rompe gli
  aggiornamenti;
- l'installazione silenziosa (`/S`) continua a funzionare. Con `oneClick: false` e
  installazione per utente non serve elevazione, quindi la firma non introduce un
  prompt UAC che prima non c'era; dove UAC compare, mostrerà il Publisher invece
  di "Editore sconosciuto".

Un miglioramento possibile, non implementato qui perché avrebbe senso solo dopo
la prima release firmata: far verificare all'updater anche la firma Authenticode
dell'installer scaricato prima di eseguirlo.

---

## 9. Cosa comunicare all'IT aziendale

Da fornire **dopo** la prima release firmata, perché oggi metà di questi dati
non esiste ancora:

- Publisher / subject completo del certificato;
- impronta SHA-1 (thumbprint) del certificato di firma;
- CA emittente;
- nome del prodotto: `Property Data Worker`;
- versione e URL della release GitHub;
- SHA-256 dell'installer, presente in `property-worker-manifest.json`;
- conferma che la firma è Authenticode con timestamp RFC 3161.

**Chiedere una allowlist per Publisher, non per hash.** L'hash cambia a ogni
release e obbligherebbe a riaprire un ticket ogni volta; una regola sul certificato
del publisher copre anche le versioni future e si revoca in un colpo solo se serve.
In Sophos Central la regola corrisponde a un'autorizzazione per *certificato*,
in alternativa a quella per *SHA-256 del file*.

Finchè la firma non esiste, l'unica richiesta possibile è l'autorizzazione per
hash della singola versione: è il motivo per cui conviene arrivare al certificato
invece di continuare a chiederla.

Non va chiesto, e non va fatto: disattivare Sophos, sospendere la protezione,
escludere cartelle di sistema o aggirare SmartScreen. Sono richieste che un IT
serio rifiuta e che peggiorano la posizione di chi le avanza.

---

## 10. Rotazione e rinnovo

Con Azure Trusted Signing il certificato ha vita breve per costruzione e viene
rinnovato dal servizio: non c'è un `.pfx` da sostituire. Va invece ruotato il
**segreto del service principal** prima della scadenza, aggiornando
`AZURE_CLIENT_SECRET`. Il timestamp garantisce che le release già pubblicate
restino valide anche dopo la scadenza del certificato con cui furono firmate.

Se il subject cambia (cambio di ragione sociale), va aggiornato
`WORKER_SIGNING_PUBLISHER` nello stesso momento, altrimenti il passo di verifica
fallisce — che è il comportamento voluto.

---

## 11. Problemi frequenti

| Sintomo | Causa | Rimedio |
| --- | --- | --- |
| `Install-Module TrustedSigning` fallisce | PSGallery non raggiungibile dal runner | Ripetere il job; verificare la rete del runner |
| `AADSTS700016` o `AADSTS7000215` | Service principal o segreto errati | Rigenerare il segreto e aggiornare `AZURE_CLIENT_SECRET` |
| Firma applicata ma publisher diverso | `WORKER_SIGNING_PUBLISHER` non identico al subject | Copiare il subject esatto da `Get-AuthenticodeSignature` |
| Build riuscita ma installer non firmato | Modalità `unsigned` o `forceCodeSigning` assente | Usare `desktop:build:signed`, che imposta entrambi |
| `firma priva di timestamp RFC 3161` | Timestamp server irraggiungibile durante la firma | Ripetere la build; non pubblicare una firma senza timestamp |
| SmartScreen avvisa ancora dopo la prima release firmata | Reputazione non ancora accumulata | Normale con un certificato non EV: si attenua con i download; non c'è scorciatoia |
