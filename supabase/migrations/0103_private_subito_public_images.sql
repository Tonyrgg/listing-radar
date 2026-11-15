begin;
-- Subito's public image API requires a transformation rule. Bare image IDs
-- return HTTP 400; use the same rule exposed by the source's image elements.
update public.private_publications p set metadata=jsonb_set(p.metadata,'{imageUrls}',
 coalesce((select jsonb_agg(to_jsonb(case
 when image.url like 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/%' and position('?' in image.url)=0
 then image.url||'?rule=gallery-mobile-1x-auto' else image.url end) order by image.ord)
 from jsonb_array_elements_text(p.metadata->'imageUrls') with ordinality image(url,ord)),'[]'::jsonb))
where p.source='subito' and jsonb_typeof(p.metadata->'imageUrls')='array';
commit;
