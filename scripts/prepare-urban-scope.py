"""Derive the operational street mask from ISTAT localities, preserving source catalogues."""
import io,json,zipfile
from pathlib import Path
import shapefile
from shapely.geometry import shape,mapping
from shapely.ops import transform,unary_union
from pyproj import Transformer

root=Path(__file__).resolve().parent.parent
cache=root/'.runtime/istat-localities';cache.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(root/'.runtime/localita-2021.zip') as z:
 for extension in ['shp','shx','dbf','prj']:
  name=next(n for n in z.namelist() if n.endswith('.'+extension))
  target=cache/('localities.'+extension)
  if not target.exists():target.write_bytes(z.read(name))
reader=shapefile.Reader(str(cache/'localities.shp'),encoding='utf-8')
projection=Transformer.from_crs(32632,4326,always_xy=True).transform
features=[]
for index,record in enumerate(reader.iterRecords()):
 d=record.as_dict()
 if d['PRO_COM']==72011 and d['TIPO_LOC']==1 and d['NOME'].upper() in ['BITONTO','PALOMBAIO','MARIOTTO']:
  geometry=transform(projection,shape(reader.shape(index).__geo_interface__).simplify(.5,preserve_topology=True))
  features.append({'type':'Feature','properties':{'name':d['NOME'],'source':'ISTAT Basi territoriali 2021','localityId':str(d['LOC_ID'])},'geometry':mapping(geometry)})
if len(features)!=3:raise RuntimeError('Expected precisely three documented centres')
mask=unary_union([shape(f['geometry']) for f in features])
catalog={str(f['properties']['official_code']):f['geometry'] for f in json.loads((root/'data/street-registry/osm-crosswalk.geojson').read_text(encoding='utf-8'))['features']}
catalog.update({s['id']:s['geometry'] for s in json.loads((root/'data/street-registry/territory-network.json').read_text(encoding='utf-8'))['streets'] if s.get('geometry')})
decisions={};clipped=outside=0
for key,value in catalog.items():
 if not value:continue
 original=shape(value);result=original.intersection(mask)
 lines=[]
 def collect(g):
  if g.geom_type=='LineString' and g.length>1e-9:lines.append(list(g.coords))
  elif hasattr(g,'geoms'):
   for child in g.geoms:collect(child)
 collect(result)
 if not lines:decisions[key]={'outside':True};outside+=1
 else:
  changed=abs(original.length-result.length)>1e-8
  if changed:clipped+=1
  decisions[key]={'outside':False,'geometry':{'type':'MultiLineString','coordinates':lines}}
metadata={'version':1,'sourceUrl':'https://www.istat.it/storage/cartografia/basi_territoriali/2021/Localita_21.zip','year':2021,'municipalityCode':'072011','outside':outside,'clipped':clipped}
(root/'data/street-registry/urban-centres.geojson').write_text(json.dumps({'type':'FeatureCollection','metadata':metadata,'features':features},ensure_ascii=False),encoding='utf-8')
(root/'worker/src/territory/renderer/urban-perimeters.js').write_text('export default '+json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(root/'worker/src/territory/urban-scope-data.json').write_text(json.dumps({'metadata':metadata,'streets':decisions},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({**metadata,'cataloguedGeometries':len(decisions),'centres':[f['properties']['name'] for f in features]}))
