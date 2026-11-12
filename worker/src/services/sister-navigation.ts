import type { Page } from 'playwright';

/** Reuse the authenticated tab; never create a second Sister session. */
export async function openSisterAddressSearch(page: Page) {
  const links=page.locator('a[href*="SceltaLink.do"]');
  for(let i=0;i<await links.count();i++) {
    const href=await links.nth(i).getAttribute('href');
    if(!href)continue;
    const target=new URL(href,page.url());
    if(target.origin===new URL(page.url()).origin && target.searchParams.get('lista')==='IND') {
      await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:20000});return;
    }
  }
  const current=new URL(page.url());
  if(current.pathname.startsWith('/Visure/')) {
    await page.goto(new URL('/Visure/SceltaLink.do?lista=IND',current).href,{waitUntil:'domcontentloaded',timeout:20000});return;
  }
  const menu=page.getByRole('link',{name:/visure catastali|consultazioni catastali/i}).first();
  if(await menu.count()) {
    await menu.click({timeout:10000});
    await page.waitForLoadState('domcontentloaded');return;
  }
  // Outside Visure, recover the authenticated entry from the existing history.
  await page.goBack({waitUntil:'domcontentloaded',timeout:15000});
}
