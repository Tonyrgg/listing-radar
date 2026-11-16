import {pointInPolygon} from '@/lib/map/geometry';
import type {GeoJsonGeometry} from '@/lib/map/types';
export function areaBounds(geometry:GeoJsonGeometry){
 const points:number[][]=[];
 function visit(value:unknown){if(!Array.isArray(value))return;if(value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number'&&value.slice(0,2).every(Number.isFinite)){points.push(value);return;}value.forEach(visit);}
 visit(geometry.coordinates);if(!points.length)return null;
 return{west:Math.min(...points.map(p=>p[0]!)),east:Math.max(...points.map(p=>p[0]!)),south:Math.min(...points.map(p=>p[1]!)),north:Math.max(...points.map(p=>p[1]!))};
}
export function inSavedArea(row:{latitude?:number|null;longitude?:number|null},geometry:GeoJsonGeometry){
 if(row.latitude==null||row.longitude==null||!Number.isFinite(row.latitude)||!Number.isFinite(row.longitude))return false;
 const point={latitude:row.latitude,longitude:row.longitude};
 return geometry.type==='MultiPolygon'&&Array.isArray(geometry.coordinates)?geometry.coordinates.some(coordinates=>pointInPolygon(point,{type:'Polygon',coordinates})):pointInPolygon(point,geometry);
}
