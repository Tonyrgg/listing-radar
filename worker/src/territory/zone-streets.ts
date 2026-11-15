/** Shared by the web archive and desktop. Membership uses positive line length,
 * including crossings with no vertex inside; touching a corner is not membership. */
export type ZoneGeometry={type:string;coordinates:unknown};
export type StreetArea={id:string;name:string;color:string;agentName:string|null;geometry:ZoneGeometry};
export type DirectoryStreet={id:string;name:string;locality:string;sisterName:string;geometry:ZoneGeometry|null;outsideUrbanArea?:boolean;linkedOfficialId?:string;needsReview?:boolean;count?:number;lastScanAt?:string|null;searchText?:string;resultName?:string};
type Point=[number,number];
const point=(v:unknown):v is Point=>Array.isArray(v)&&v.length>=2&&v.slice(0,2).every(n=>typeof n==='number'&&Number.isFinite(n));
function polygons(g:ZoneGeometry):Point[][][]{
 const raw=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 if(!Array.isArray(raw))return [];
 return raw.filter(Array.isArray).map(p=>p.filter(Array.isArray).map(r=>r.filter(point))).filter(p=>p.length&&p[0]!.length>=3);
}
function lines(g:ZoneGeometry|null):Point[][]{
 const raw=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
 return Array.isArray(raw)?raw.filter(Array.isArray).map(r=>r.filter(point)).filter(r=>r.length>=2):[];
}
const cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0];
const subtract=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]];
function onEdge(p:Point,a:Point,b:Point){return Math.abs(cross(subtract(p,a),subtract(b,a)))<1e-12&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12;}
function ringContains(p:Point,ring:Point[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i]!,b=ring[j]!;if(onEdge(p,a,b))return true;
 if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function contains(p:Point,poly:Point[][]){return ringContains(p,poly[0]!)&&!poly.slice(1).some(h=>ringContains(p,h));}
function segmentInside(a:Point,b:Point,poly:Point[][]){
 const d=subtract(b,a),cuts=[0,1];
 for(const ring of poly)for(let i=0;i<ring.length;i++){
  const c=ring[i]!,e=subtract(ring[(i+1)%ring.length]!,c),den=cross(d,e);if(Math.abs(den)<1e-16)continue;
  const t=cross(subtract(c,a),e)/den,u=cross(subtract(c,a),d)/den;
  if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
 }
 cuts.sort((x,y)=>x-y);let length=0;
 for(let i=1;i<cuts.length;i++){
  const start=cuts[i-1]!,end=cuts[i]!,mid=(start+end)/2;
  if(contains([a[0]+d[0]*mid,a[1]+d[1]*mid],poly))length+=(end-start)*Math.hypot(d[0]*Math.cos(a[1]*Math.PI/180),d[1])*111195;
 }return length;
}
function bounds(points:Point[]){return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
export function buildZoneStreetDirectory(streets:DirectoryStreet[],areas:StreetArea[]){
 const shapes=areas.map(area=>{const parts=polygons(area.geometry);return{area,parts,bounds:bounds(parts.flat(2))};});
 const rows=streets.filter(s=>!s.linkedOfficialId&&!s.outsideUrbanArea).map(street=>{
  const paths=lines(street.geometry),box=bounds(paths.flat()),areaIds:string[]=[];
  for(const shape of shapes){
   const b=shape.bounds;if(box[0]!>b[2]!||box[2]!<b[0]!||box[1]!>b[3]!||box[3]!<b[1]!)continue;
   let length=0;
   for(const poly of shape.parts)for(const line of paths)for(let i=1;i<line.length;i++)length+=segmentInside(line[i-1]!,line[i]!,poly);
   if(length>.5)areaIds.push(shape.area.id);
  }
  return{...street,areaIds,unlocated:paths.length===0};
 }).sort((a,b)=>a.name.localeCompare(b.name,'it',{numeric:true})||a.id.localeCompare(b.id));
 return{areas:areas.map(area=>({...area,streetCount:rows.filter(s=>s.areaIds.includes(area.id)).length})),streets:rows};
}
export type ZoneStreetDirectory=ReturnType<typeof buildZoneStreetDirectory>;
