-- -----------------------------------------------------------------------------
-- Copertura di ogni richiesta, a scaglioni.
--
-- La 0004 rispondeva a una domanda sola: «questa richiesta ha almeno una casa
-- proponibile?». Le richieste completamente scoperte sono risultate quattro, e
-- quattro nomi non bastano a decidere cosa andare a cercare: fra chi non ha
-- niente e chi è servito ci sono i clienti con una sola casa buona, che sono
-- scoperti quasi quanto gli altri e non comparivano da nessuna parte.
--
-- Qui la risposta diventa una misura invece di un sì o no, e la pagina può
-- ordinare le richieste dalla più povera alla più servita.
--
-- Gli scaglioni:
--   excellent_count  90+   la casa giusta, non una che ci somiglia
--   proposable_count 80+   la soglia sotto cui non si porta al cliente
--   near_count       70-79 la sfiora: non si propone, ma dice che il mercato
--                          qualcosa ce l'ha e forse basta un ritocco ai criteri
--
-- La soglia degli 80 è ripetuta in `MIN_PROPOSABLE_SCORE`
-- (src/lib/matching/repository.ts): sono la stessa decisione detta due volte,
-- una al database e una alla pagina. Se cambia, vanno cambiate entrambe.
create or replace function public.matching_request_coverage()
returns table (
  request_id uuid,
  best_score numeric,
  excellent_count integer,
  proposable_count integer,
  near_count integer
)
language sql
stable
as $$
  select
    m.request_id,
    max(m.score) as best_score,
    count(*) filter (where m.score >= 90)::integer as excellent_count,
    count(*) filter (where m.score >= 80)::integer as proposable_count,
    count(*) filter (where m.score >= 70 and m.score < 80)::integer as near_count
  from public.request_property_matches m
  group by m.request_id;
$$;

comment on function public.matching_request_coverage() is
  'Copertura di ogni richiesta a scaglioni: punteggio migliore, abbinamenti eccellenti (90+), proponibili (80+) e sfiorati (70-79).';

grant execute on function public.matching_request_coverage() to authenticated, service_role;
