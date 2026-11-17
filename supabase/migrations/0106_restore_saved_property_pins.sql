begin;
set local statement_timeout='90s';
-- Restore only missing pins from retained evidence belonging to this property.
-- Shared area rows, human choices, rejected Ad Maiora pins and conflicting streets are excluded.
with candidates as materialized (
 select l.id, evidence.payload,evidence.observed_at,evidence.canonical_url
 from public.properties p join public.locations l on l.id=p.primary_location_id
 cross join lateral (
  select s.normalized_payload as payload,s.observed_at,u.canonical_url
  from public.agency_listings a join public.publications u on u.agency_listing_id=a.id join public.snapshots s on s.publication_id=u.id
  where a.property_id=p.id and s.normalized_payload->>'adapterKey'<>'admaiora'
  and jsonb_typeof(s.normalized_payload#>'{location,latitude}')='number'
  and jsonb_typeof(s.normalized_payload#>'{location,longitude}')='number'
  and (s.normalized_payload#>>'{location,latitude}')::numeric between 40.9 and 41.2
  and (s.normalized_payload#>>'{location,longitude}')::numeric between 16.4 and 16.9
  and (l.street_name is null or lower(trim(l.street_name))=lower(trim(s.normalized_payload#>>'{location,streetName}')))
  and (l.street_number is null or l.street_number=s.normalized_payload#>>'{location,streetNumber}')
  order by s.observed_at desc,s.id desc limit 1
 ) evidence
 where l.latitude is null and l.longitude is null and not l.manually_verified
 and (select count(*) from public.properties same where same.primary_location_id=l.id)=1
)
update public.locations l set latitude=(c.payload#>>'{location,latitude}')::float8,longitude=(c.payload#>>'{location,longitude}')::float8,
 metadata=coalesce(l.metadata,'{}'::jsonb)||jsonb_build_object('historicalPinRecovery',jsonb_build_object('sourceUrl',c.canonical_url,'observedAt',c.observed_at,'independentlyVerified',false,'method','LAST_VALID_SAVED_PROPERTY_READING'))
from candidates c where c.id=l.id;
notify pgrst,'reload schema';
commit;
