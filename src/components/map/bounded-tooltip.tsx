"use client";
import type {ReactNode} from 'react';
import {Tooltip,useMap} from 'react-leaflet';
import L from 'leaflet';
import styles from './territory-archive.module.css';

/** Keep the whole preview within the map, including markers near an edge. */
export function BoundedTooltip({children}:{children:ReactNode}) {
  const map=useMap();
  return <Tooltip direction="top" offset={[0,-16]} opacity={1} interactive className={styles.hover} eventHandlers={{add:event=>{
    const tooltip=event.target as L.Tooltip,element=tooltip.getElement();
    if(!element)return;
    const bounds=map.getContainer().getBoundingClientRect(),preview=element.getBoundingClientRect();
    const shiftX=preview.left<bounds.left+8?bounds.left+8-preview.left:preview.right>bounds.right-8?bounds.right-8-preview.right:0;
    const shiftY=preview.top<bounds.top+8?bounds.top+8-preview.top:preview.bottom>bounds.bottom-8?bounds.bottom-8-preview.bottom:0;
    if(shiftX||shiftY){
      const offset=L.point(tooltip.options.offset??[0,-16]);
      tooltip.options.offset=L.point(offset.x+shiftX,offset.y+shiftY);
      tooltip.update();
    }
  }}}>{children}</Tooltip>;
}
