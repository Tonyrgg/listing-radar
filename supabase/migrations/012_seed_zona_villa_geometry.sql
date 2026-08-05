-- Primo perimetro della suddivisione immobiliare di Bitonto: zona 3, Villa.
-- Le coordinate sono GeoJSON nel formato [longitudine, latitudine].

update public.internal_zones
set
  geometry = '{
    "type": "Polygon",
    "coordinates": [[
      [16.6950, 41.1147],
      [16.6980, 41.1162],
      [16.7012, 41.1148],
      [16.7023, 41.1134],
      [16.7014, 41.1100],
      [16.7002, 41.1083],
      [16.6974, 41.1084],
      [16.6957, 41.1090],
      [16.6950, 41.1110],
      [16.6939, 41.1130],
      [16.6950, 41.1147]
    ]]
  }'::jsonb,
  color = '#5f9f55',
  updated_at = now()
where lower(trim(name)) = 'zona villa'
  and geometry is null;
