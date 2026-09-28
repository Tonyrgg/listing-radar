# Architettura corrente

Next.js 16 App Router ospita UI privata e server actions. `requireUser()` verifica la sessione nei punti di scrittura; il client service role resta lato server. Supabase/PostgreSQL è il database operativo. Non sono presenti configurazioni Neon operative.

Property Lifecycle V2 normalizza adapter di agenzia, pubblicazioni private, proprietà fisiche, snapshot ed eventi. `lifecycle_jobs` e i worker di sincronizzazione gestiscono raccolta e audit. Il bridge privati esistente importa le pubblicazioni del vecchio Radar; nessuna nuova entità commerciale usa `listings` come chiave. I trigger della migration 0010 trasformano nuove pubblicazioni private e ribassi in eventi V2 e poi in segnali commerciali. Le osservazioni di agenzia da sole non generano chiamate commerciali.

`acquisition_leads` è la pipeline commerciale e si collega facoltativamente alla proprietà V2 e a un contatto; `acquisition_lead_requests` collega più richieste buyer allo stesso lead. `acquisition_signals` conserva le notizie; `acquisition_activities` la timeline; `acquisition_appointments` gli appuntamenti e gli esiti. Le server actions in `app/(private)/acquisition/actions.ts` validano input e scrivono i dati. La vista `acquisition_today_queue` ordina la coda nel database; la funzione `acquisition_kpis` calcola aggregati senza caricare tutto lo storico nel frontend. Il Property Data Worker Electron è separato: SISTER e Tecnocloud con job e checkpoint propri. È stato corretto il timeout della ricerca cliente su schermate ambigue; il worker non è stato pubblicato.

Le route cron ed import esistenti restano sotto `app/api`. Il deploy web è Vercel; il worker desktop viene consegnato tramite GitHub Releases. Per dettagli adapter, identità e salute fonti: `docs/property-lifecycle/`.

## Diario universale (`0011`)

La vista SQL `universal_logbook` unifica le tabelle sorgente senza copiarle.
`logbook_entries` raccoglie solo attività manuali non già rappresentate dalle
attività dei lead e i match buyer significativi. `monthly_focus` conserva
selezioni per mese; `monthly_focus_overview`, `logbook_month_summary` e
`acquisition_stale` forniscono cockpit e aggregati. I dati V2 di mercato sono
letti da `events` e restano la fonte autorevole. Le server actions del Diario
scrivono nel CRM esistente quando è presente un lead.

Le pagine private usano il service client solo dopo il controllo della sessione.
Le viste cross-CRM `security_invoker` sono leggibili soltanto dal ruolo server;
non diventano endpoint pubblici. Il worker non è modificato dalla migration.
Dettagli operativi: `docs/UNIVERSAL_LOGBOOK.md`.
