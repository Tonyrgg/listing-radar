-- Explicit user confirmation on 19 October 2026: this branch is OUR_AGENCY.
-- This never classifies the whole Tecnocasa brand as our portfolio.
begin;
update public.agencies set market_role='OUR_AGENCY',
 settings=jsonb_set(settings,'{marketObserverRegistry}',
  coalesce(settings->'marketObserverRegistry','{}'::jsonb)||jsonb_build_object(
   'humanConfirmed',true,'confidence',1,'roleBasis','HUMAN_CONFIRMED_BRANCH',
   'confirmationSource','USER_EXPLICIT_SESSION_CONFIRMATION','confirmedAt',now()))
where slug='tecnocasa-bitonto-matteotti'
 and website_url='https://bitonto2.tecnocasa.it/bitonto/bitonto/';
commit;
