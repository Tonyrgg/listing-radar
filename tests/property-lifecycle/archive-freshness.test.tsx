import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const mocks=vi.hoisted(()=>({sources:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseServiceClient:()=>({from:()=>({select:()=>({single:async()=>({data:{source_revision:2,refreshed_revision:2,refreshed_at:'2026-11-11T20:00:00Z',last_error:null},error:null})})})})}));
vi.mock('@/lib/sources-health',()=>({getSourcesSummary:mocks.sources}));
import {ArchiveFreshness} from '@/components/archive-freshness';
it('does not confuse a freshly rebuilt archive with successfully read portals',async()=>{
 mocks.sources.mockResolvedValue({available:true,total:9,healthy:8,broken:[{name:'Fonte non disponibile',note:'non ha risposto'}],partial:[]});
 const html=renderToStaticMarkup(await ArchiveFreshness());
 expect(html).toContain('Vista dell’archivio elaborata');
 expect(html).toContain('non attestano un aggiornamento completo');
 expect(html).toContain('Fonte non disponibile');
 expect(html).not.toContain('risultano sane');
});
it('does not declare sources healthy when their status cannot be read',async()=>{
 mocks.sources.mockResolvedValue({available:false,broken:[],partial:[]});
 const html=renderToStaticMarkup(await ArchiveFreshness());
 expect(html).toContain('Stato delle letture non verificabile');
 expect(html).not.toContain('risultano sane');
});
