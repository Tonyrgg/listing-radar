import {expect,it} from 'vitest';
import {portalUrl} from '../../scripts/private-radar-add-urls';
it('accepts both user reports and strips tracking without accepting arbitrary hosts',()=>{
 expect(portalUrl('https://www.immobiliare.it/annunci/133655902/?x=1#photo')).toEqual({source:'immobiliare',source_listing_id:'133655902',canonical_url:'https://www.immobiliare.it/annunci/133655902/'});
 expect(portalUrl('https://www.immobiliare.it/annunci/116014055/').source_listing_id).toBe('116014055');
 for(const url of ['http://www.immobiliare.it/annunci/123/','https://evil.test/annunci/123/','https://www.immobiliare.it/vendita-case/bitonto/','https://name:secret@www.immobiliare.it/annunci/123/'])expect(()=>portalUrl(url)).toThrow();
});
