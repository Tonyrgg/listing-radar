import {it,expect,vi} from 'vitest';
import type {Page} from 'playwright';
import {openSisterAddressSearch} from '../src/services/sister-navigation.js';
it('uses the address menu on arbitrary authenticated pages, preserving office parameters',async()=>{
 const hrefs=['/Visure/SceltaLink.do?lista=PF','/Visure/SceltaLink.do?lista=IND&ufficio=BA'];
 const goto=vi.fn();const page={url:()=> 'https://sister3.agenziaentrate.gov.it/Visure/other.do',goto,locator:()=>({count:async()=>2,nth:(i:number)=>({getAttribute:async()=>hrefs[i]})})};
 await openSisterAddressSearch(page as unknown as Page);
 expect(goto).toHaveBeenCalledWith('https://sister3.agenziaentrate.gov.it/Visure/SceltaLink.do?lista=IND&ufficio=BA',expect.anything());
});
it('recovers the address entry from a detail without a menu using the same tab',async()=>{
 const goto=vi.fn();const page={url:()=> 'https://sister3.agenziaentrate.gov.it/Visure/vind/detail.do',goto,locator:()=>({count:async()=>0})};
 await openSisterAddressSearch(page as unknown as Page);
 expect(goto).toHaveBeenCalledWith('https://sister3.agenziaentrate.gov.it/Visure/SceltaLink.do?lista=IND',expect.anything());
});
it('does not follow a foreign menu link',async()=>{
 const goto=vi.fn(),goBack=vi.fn();const page={url:()=> 'https://sister3.agenziaentrate.gov.it/home',goto,goBack,getByRole:()=>({first:()=>({count:async()=>0})}),locator:()=>({count:async()=>1,nth:()=>({getAttribute:async()=> 'https://other.test/SceltaLink.do?lista=IND'})})};
 await openSisterAddressSearch(page as unknown as Page);expect(goto).not.toHaveBeenCalled();expect(goBack).toHaveBeenCalledOnce();
});
