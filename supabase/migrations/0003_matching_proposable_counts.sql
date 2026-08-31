-- -----------------------------------------------------------------------------
-- Quanti abbinamenti proponibili ha ogni richiesta.
--
-- Serve a rispondere alla domanda opposta a quella solita: non «quali case
-- vanno bene a questo cliente», ma «per quali clienti non abbiamo niente». È
-- l'elenco da cui parte la ricerca di nuovi immobili, quindi deve essere esatto:
-- una richiesta che risulta scoperta mentre invece è servita manda a cercare
-- una casa che non serve, e una servita che risulta coperta lascia un cliente
-- senza risposta.
--
-- Il conteggio lo fa il database. Ricavarlo dalle righe scaricate dalla pagina
-- non funziona: quelle arrivano con un limite, e le richieste tagliate fuori
-- sembrerebbero scoperte. È lo stesso errore che aveva già colpito il conteggio
-- dei compatibili, quando 159 richieste su 254 leggevano «nessuna casa le
-- somiglia» perché le righe oltre il migliaio non arrivavano.
--
-- Un match a punteggio zero è stato escluso da un filtro duro — contratto,
-- tipologia o ascensore obbligatorio — e non è una proposta: qui non si conta,
-- esattamente come non compare nelle liste.
create or replace function public.matching_proposable_counts()
returns table (request_id uuid, proposable_count integer)
language sql
stable
as $$
  select m.request_id, count(*)::integer
  from public.request_property_matches m
  where m.score > 0
  group by m.request_id;
$$;

comment on function public.matching_proposable_counts() is
  'Abbinamenti proponibili (punteggio maggiore di zero) contati per richiesta.';

grant execute on function public.matching_proposable_counts() to authenticated, service_role;

create index if not exists request_property_matches_score_request_idx
  on public.request_property_matches (request_id, score);
