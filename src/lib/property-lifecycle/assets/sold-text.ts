import { createWorker } from "tesseract.js";
import sharp from "sharp";
import {tmpdir} from "node:os";

export function isExplicitSoldText(text:string,confidence:number):boolean {
  if(confidence<75)return false;
  const words=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return words.split(/\r?\n/).some(line=>/^(?:IMMOBILE\s+)?(?:VENDUTO|VENDUTA|SOLD)[!.]*$/.test(line.trim()));
}
let worker:ReturnType<typeof createWorker>|undefined;
export async function inspectSoldText(bytes:Uint8Array):Promise<boolean>{
  worker??=createWorker("ita",1,{logger:()=>{},cachePath:tmpdir()});
  try {
    const image=await sharp(bytes).rotate().resize({width:1400,withoutEnlargement:true}).png().toBuffer();
    const result=await (await worker).recognize(image);
    return isExplicitSoldText(result.data.text,result.data.confidence);
  } catch(error) { worker=undefined; throw error; }
}
export async function closeSoldTextWorker(){if(worker){await(await worker).terminate();worker=undefined;}}
