-- -----------------------------------------------------------------------------
-- Quanto è coperta ogni richiesta.
--
-- La 0003 contava gli abbinamenti con punteggio sopra zero. Era il criterio
-- sbagliato: quasi ogni richiesta ha almeno una casa che la sfiora — un
-- punteggio del dodici per cento è pur sempre sopra zero — quindi nessuna
-- richiesta risultava scoperta e la funzione non diceva niente a nessuno.
--
-- Scoperta non vuol dire «non ha nemmeno una riga in tabella»: vuol dire «non
-- ha niente che valga la pena mostrare al cliente». La soglia è la stessa che
-- l'interfaccia usa già per dire «Poco pertinente», cioè la classificazione
-- calcolata dal motore: sotto quella non è una proposta.
--
-- Torna anche il punteggio migliore, perché una richiesta ferma al dodici per
-- cento e una ferma al trentotto sono due urgenze diverse, e chi cerca casa per
-- quel cliente merita di saperlo prima di uscire.
create or replace function public.matching_request_coverage()
returns table (
  request_id uuid,
  best_score numeric,
  proposable_count integer,
  relevant_count integer
)
language sql
stable
as $$
  select
    m.request_id,
    max(m.score) as best_score,
    count(*) filter (where m.score > 0)::integer as proposable_count,
    count(*) filter (where m.classification <> 'not_relevant')::integer as relevant_count
  from public.request_property_matches m
  group by m.request_id;
$$;

comment on function public.matching_request_coverage() is
  'Copertura di ogni richiesta: punteggio migliore, abbinamenti proponibili e abbinamenti che superano la soglia di rilevanza.';

grant execute on function public.matching_request_coverage() to authenticated, service_role;

-- La funzione della 0003 non è più usata da nessuno.
drop function if exists public.matching_proposable_counts();
