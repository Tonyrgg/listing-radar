import { spawn, type ChildProcess } from "node:child_process";
import sharp from "sharp";

export function isExplicitSoldText(text:string,confidence:number):boolean {
  if(confidence<75)return false;
  const words=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return words.split(/\r?\n/).some(line=>/^(?:IMMOBILE\s+)?(?:VENDUTO|VENDUTA|SOLD)[!.]*$/.test(line.trim()));
}
// Isolate native/WASM failures and stalled initialization from the queue drainer.
// A failed OCR is unavailable evidence, never evidence that the image says SOLD.
const OCR_PROCESS = `
const {createWorker}=require('tesseract.js');
const {tmpdir}=require('node:os');
let worker;
process.on('message',async message=>{
  try {
    worker??=createWorker('ita',1,{logger:()=>{},cachePath:tmpdir()});
    const result=await(await worker).recognize(Buffer.from(message.image,'base64'));
    process.send({text:result.data.text,confidence:result.data.confidence});
  } catch(error){process.send({error:String(error)});}
});
`;
let child: ChildProcess | undefined;
let serial: Promise<unknown> = Promise.resolve();

function recognize(image: Buffer): Promise<{text:string;confidence:number}> {
  child ??= spawn(process.execPath, ['-e', OCR_PROCESS], {stdio:['ignore','ignore','pipe','ipc']});
  const processWorker=child;
  return new Promise((resolve,reject)=>{
    let diagnostic='';
    const timeout=setTimeout(()=>fail(new Error('Sold-image OCR exceeded 45 seconds')),45_000);
    const cleanup=()=>{
      clearTimeout(timeout);
      processWorker.off('message',onMessage);processWorker.off('error',fail);processWorker.off('exit',onExit);
      processWorker.stderr?.off('data',onDiagnostic);
    };
    const fail=(error:Error)=>{
      cleanup();
      if(child===processWorker)child=undefined;
      processWorker.kill();
      reject(error);
    };
    const onExit=(code:number|null)=>fail(new Error(`Sold-image OCR exited (${code}): ${diagnostic.slice(-300)}`));
    const onDiagnostic=(chunk:Buffer)=>{diagnostic=(diagnostic+chunk.toString()).slice(-2_048);};
    const onMessage=(message:unknown)=>{
      const result=message as {error?:unknown;text?:unknown;confidence?:unknown};
      if(result?.error)return fail(new Error(String(result.error)));
      if(typeof result?.text!=='string'||typeof result?.confidence!=='number'||!Number.isFinite(result.confidence))return fail(new Error('Invalid OCR response'));
      cleanup();resolve({text:result.text,confidence:result.confidence});
    };
    processWorker.on('message',onMessage);processWorker.once('error',fail);processWorker.once('exit',onExit);
    processWorker.stderr?.on('data',onDiagnostic);
    processWorker.send({image:image.toString('base64')},error=>{if(error)fail(error);});
  });
}

export async function inspectSoldText(bytes:Uint8Array):Promise<boolean>{
  const inspect=async()=>{
    const image=await sharp(bytes).rotate().resize({width:1400,withoutEnlargement:true}).png().toBuffer();
    const result=await recognize(image);
    return isExplicitSoldText(result.text,result.confidence);
  };
  const result=serial.then(inspect,inspect);
  serial=result.catch(()=>{});
  return result;
}
export async function closeSoldTextWorker(){
  const previous=child;child=undefined;
  previous?.kill();
}
