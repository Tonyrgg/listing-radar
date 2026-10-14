import {existsSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "@playwright/test";
const base=process.env.MARKET_OBSERVER_E2E_BASE_URL??"http://localhost:3132";
if(!["localhost","127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Use a local test server.");
const executablePath=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const errors=[],results=[];
const folder=".runtime/market-observer-ui";
await mkdir(folder,{recursive:true});
try{
  const page=await browser.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  for(const width of [390,1024,1600]){
    await page.setViewportSize({width,height:950});
    for(const view of ["mercato","opportunita","usciti","venduti"]){
      const response=await page.goto(`${base}/intelligence?vista=${view}`,{waitUntil:"networkidle"});
      if(response?.status()!==200) throw new Error(`HTTP ${response?.status()} ${view}`);
      await page.getByRole("heading",{name:"Intelligence",exact:true}).waitFor();
      if(await page.getByRole("heading",{name:"Intelligence non disponibile"}).count()) throw new Error("The fixture did not reach the page.");
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
      if(overflow) throw new Error(`Horizontal overflow ${view} ${width}`);
      const content=await page.locator("main").innerText();
      if(/SOLD_CONFIRMED|UNKNOWN_EXIT|MISSING_UNCONFIRMED/.test(content)) throw new Error("Raw state leaked into the UI.");
      await page.screenshot({path:`${folder}/${view}-${width}.png`,fullPage:true});
      results.push({view,width,overflow:false});
    }
    await page.goto(`${base}/casa/11111111-1111-4111-8111-111111111111`,{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"Via Giuseppe Mazzini 10",exact:true}).waitFor();
    await page.getByText("Come si compone il punteggio",{exact:true}).click();
    await page.getByText("Prezzi per pubblicazione",{exact:true}).click();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)) throw new Error(`Property overflow ${width}`);
    if(!await page.getByRole("button",{name:"Porta in Acquisizioni"}).isVisible()) throw new Error("Commercial next action missing.");
    await page.screenshot({path:`${folder}/property-${width}.png`,fullPage:true});
    results.push({view:"property",width,overflow:false});
  }
  if(errors.length) throw new Error(errors.join("\n"));
  await writeFile(`${folder}/results.json`,JSON.stringify({syntheticReadOnly:true,results,errors},null,2));
  console.log(`${results.length} visual scenarios passed: 390, 1024 and 1600 px; no horizontal overflow or runtime errors.`);
}finally{await browser.close();}
