import type {Metadata} from 'next';
import {PageHeader} from '@/components/page-header';
import {listAgents,listMapAreas} from '@/lib/map/queries';
import {WorkAreaEditor} from '@/components/map/work-area-editor';
export const metadata:Metadata={title:'Zone di lavoro'};

export default async function WorkAreasPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const [areas,agents,params]=await Promise.all([listMapAreas(),listAgents(),searchParams]);
  return <div className="space-y-6"><PageHeader title="Zone di lavoro" description="Disegna una zona o modifica nome, assegnazione e confini di quelle salvate."/>
    <WorkAreaEditor initialAreas={areas} agents={agents} initialId={typeof params.zona==='string'?params.zona:null} startNew={params.nuova==='1'}/>
  </div>;
}
