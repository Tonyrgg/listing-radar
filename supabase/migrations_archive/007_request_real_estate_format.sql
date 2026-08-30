-- Allinea il formato delle richieste ai campi realmente usati nel gestionale.
alter table public.property_requests
  add column if not exists destination text,
  add column if not exists financing_method text,
  add column if not exists credit_status text,
  add column if not exists requested_floor_band text,
  add column if not exists from_own_listing boolean not null default false;

alter table public.property_requests
  drop constraint if exists property_requests_destination_check,
  add constraint property_requests_destination_check
    check (destination is null or destination in (
      'first_home', 'investment', 'exchange', 'temporary', 'other'
    )),
  drop constraint if exists property_requests_financing_method_check,
  add constraint property_requests_financing_method_check
    check (financing_method is null or financing_method in (
      'cash', 'cash_and_mortgage', 'full_mortgage', 'exchange', 'other'
    )),
  drop constraint if exists property_requests_credit_status_check,
  add constraint property_requests_credit_status_check
    check (credit_status is null or credit_status in (
      'unknown', 'in_progress', 'positive', 'negative'
    )),
  drop constraint if exists property_requests_requested_floor_band_check,
  add constraint property_requests_requested_floor_band_check
    check (requested_floor_band is null or requested_floor_band in (
      'any', 'low', 'medium', 'high', 'top'
    ));

