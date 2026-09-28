-- Run only against an isolated local Supabase project. Fixture rows roll back.
begin;
do $$
declare
  v_location uuid; v_property uuid; v_contact uuid; v_client uuid;
  v_lead uuid; v_stale uuid; v_fresh uuid; v_event uuid; v_request uuid; v_focus uuid;
  v_portfolio uuid; v_match uuid; v_action uuid;
  v_result jsonb; v_dedupe text;
begin
  if not has_table_privilege('service_role','public.clients','INSERT')
    or not has_table_privilege('service_role','public.property_requests','UPDATE')
    or not has_table_privilege('service_role','public.universal_logbook','SELECT')
    or has_table_privilege('authenticated','public.universal_logbook','SELECT') then
    raise exception 'Server/browser database grants are inconsistent';
  end if;
  insert into public.locations(raw_text,locality,scope_state)
    values ('Via Test 12','Bitonto','IN_SCOPE') returning id into v_location;
  insert into public.properties(primary_location_id)
    values (v_location) returning id into v_property;
  insert into public.clients(full_name,phone) values ('Buyer Test','3330000000')
    returning id into v_client;
  insert into public.acquisition_contacts(full_name,phone,client_id,contact_status)
    values ('Proprietario Test','3331111111',v_client,'reviewed')
    returning id into v_contact;
  insert into public.acquisition_leads(property_id,contact_id,address,locality,source_type,
    status,priority,created_at)
    values (v_property,v_contact,'Via Test 12','Bitonto','fsbo',
      'FOLLOW_UP','A',now()-interval '8 days') returning id into v_lead;
  insert into public.property_requests(client_id,title,contract_type,needs_to_sell_first,
    property_to_sell_id,status)
    values (v_client,'Cerco casa test','sale','yes',v_property,'active')
    returning id into v_request;
  insert into public.portfolio_properties(title,contract_type,property_type)
    values ('Casa buyer test','sale','apartment') returning id into v_portfolio;
  insert into public.request_property_matches(request_id,property_id,score,classification)
    values (v_request,v_portfolio,92,'compatible') returning id into v_match;
  update public.request_property_matches set score = 95 where id = v_match;
  if (select count(*) from public.universal_logbook u where u.request_id = v_request
      and u.event_type = 'buyer_match_found') <> 1 then
    raise exception 'Strong buyer match missing or duplicated by recalculation';
  end if;
  update public.request_property_matches set status = 'proposed' where id = v_match;
  if (select count(*) from public.universal_logbook u where u.request_id = v_request
      and u.event_type = 'buyer_match_status' and u.outcome = 'proposed') <> 1 then
    raise exception 'Buyer match promotion missing';
  end if;
  insert into public.events(property_id,event_type,occurred_at,dedupe_key)
    values (v_property,'PRIVATE_PRICE_DROP',now(),gen_random_uuid()::text)
    returning id into v_event;
  select dedupe_key into v_dedupe from public.events where id = v_event;
  insert into public.events(property_id,event_type,occurred_at,dedupe_key)
    values (v_property,'PRIVATE_PRICE_DROP',now(),v_dedupe)
    on conflict (dedupe_key) do nothing;
  insert into public.acquisition_signals(lead_id,property_id,event_id,source_type,signal_type)
    values (v_lead,v_property,v_event,'fsbo','price_cut');
  if (select count(*) from public.universal_logbook u where u.lead_id = v_lead
      and u.source_id = v_event) <> 1 then
    raise exception 'Market event was duplicated or not linked to opportunity';
  end if;
  if (select count(*) from public.universal_logbook u where u.property_id = v_property
      and u.source_id = v_event) <> 1 then
    raise exception 'Price cut missing from property timeline';
  end if;
  insert into public.acquisition_activities(lead_id,activity_type,outcome,note)
    values (v_lead,'phone_call','conversation','Telefonata test');
  insert into public.logbook_entries(event_category,event_type,title,lead_id,
    next_action_type,next_action_at)
    values ('FIELD','zone_visit','Zona domani',v_lead,'Verifica',now()+interval '1 day')
    returning id into v_action;
  if not exists (select 1 from public.universal_logbook u
      where u.source_id = v_action and u.requires_action
        and u.next_action_type = 'Verifica' and u.next_action_at is not null) then
    raise exception 'Scheduled logbook action missing from ledger';
  end if;
  update public.logbook_entries set action_completed_at = now() where id = v_action;
  if exists (select 1 from public.universal_logbook u
      where u.source_id = v_action and u.requires_action) then
    raise exception 'Completed action still marked pending';
  end if;
  update public.acquisition_leads set next_action_type = 'follow_up',
    next_action_at = now() where id = v_lead;
  if not exists (select 1 from public.acquisition_today_queue q where q.id = v_lead) then
    raise exception 'Follow-up missing from Today queue';
  end if;
  if (select count(*) from public.universal_logbook u where u.event_type = 'phone_call'
      and u.contact_id = v_contact and u.property_id = v_property
      and u.lead_id = v_lead and u.client_id = v_client) <> 1 then
    raise exception 'Call missing from person/property/opportunity timeline';
  end if;
  insert into public.monthly_focus(month_start,lead_id)
    values ('2030-09-01',v_lead) returning id into v_focus;
  if not exists (select 1 from public.monthly_focus_overview f
      where f.id = v_focus and f.label = 'Via Test 12') then
    raise exception 'Focus overview missing';
  end if;
  if exists (select 1 from public.monthly_focus f
      where f.lead_id = v_lead and f.month_start = '2030-10-01') then
    raise exception 'Focus carried over without confirmation';
  end if;
  begin
    insert into public.monthly_focus(month_start,lead_id) values ('2030-09-01',v_lead);
    raise exception 'Focus duplicate was accepted';
  exception when unique_violation then null;
  end;
  insert into public.logbook_entries(event_category,event_type,source_type,title,
    contact_id,client_id,property_id,lead_id,occurred_at)
    values ('CONTACT','note','manual','Fine settembre',v_contact,v_client,
      v_property,v_lead,'2030-09-30 21:30+00');
  insert into public.logbook_entries(event_category,event_type,source_type,title,
    contact_id,client_id,property_id,lead_id,occurred_at)
    values ('CONTACT','note','manual','Inizio ottobre',v_contact,v_client,
      v_property,v_lead,'2030-09-30 22:30+00');
  v_result := public.logbook_month_summary('2030-09-01');
  if (v_result->>'events')::int <> 1 then
    raise exception 'September boundary failed: %',v_result;
  end if;
  v_result := public.logbook_month_summary('2030-10-01');
  if (v_result->>'events')::int <> 1 then
    raise exception 'October boundary failed: %',v_result;
  end if;
  insert into public.acquisition_leads(address,locality,source_type,status,priority,created_at)
    values ('Via Ferma 1','Bitonto','zone','VERIFY','A',now()-interval '5 days')
    returning id into v_stale;
  if not exists (select 1 from public.acquisition_stale(3,7,14) x
      where x.id = v_stale and x.reason = 'Senza prossima azione') then
    raise exception 'Stale lead missing';
  end if;
  insert into public.acquisition_leads(address,locality,source_type,status,priority,
    created_at,next_action_type,next_action_at)
    values ('Via Ripresa 2','Bitonto','zone','VERIFY','A',now()-interval '5 days',
      'verification',now()+interval '4 days') returning id into v_fresh;
  insert into public.logbook_entries(event_category,event_type,title,lead_id)
    values ('FIELD','property_check','Verifica recente',v_fresh);
  if exists (select 1 from public.acquisition_stale(3,7,14) x where x.id = v_fresh) then
    raise exception 'Recent manual activity wrongly marked stale';
  end if;
  if not exists (select 1 from public.universal_logbook u
      where u.request_id = v_request and u.client_id = v_client
        and u.event_type = 'buyer_request_created') then
    raise exception 'Buyer request missing from client timeline';
  end if;
end $$;
rollback;
