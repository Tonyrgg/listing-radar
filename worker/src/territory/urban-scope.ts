import data from './urban-scope-data.json' with {type:'json'};
import type {TerritoryState,Geometry} from './model.js';
export function applyUrbanScope(state:TerritoryState){
 const decisions=data.streets as Record<string,{outside:boolean;geometry?:Geometry}>;
 for(const street of state.streets){
  const scope=decisions[street.id];if(!scope)continue;
  street.outsideUrbanArea=scope.outside;
  street.geometry=scope.geometry??null;
  street.geometryEvidence='Tracciato OSM ritagliato sui centri abitati ISTAT 2021; fonte: '+data.metadata.sourceUrl;
 }
}
