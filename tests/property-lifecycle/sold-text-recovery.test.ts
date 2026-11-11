import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {EventEmitter} from 'node:events';
const fake = vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:fake.spawn}));
import { inspectSoldText, closeSoldTextWorker } from '@/lib/property-lifecycle/assets/sold-text';
it('isolates a crashed OCR process and starts a fresh one for the next photo',async()=>{
  const children: Array<EventEmitter & {stderr:EventEmitter;kill:ReturnType<typeof vi.fn>;send:ReturnType<typeof vi.fn>}> = [];
  fake.spawn.mockImplementation(()=>{
    const child=Object.assign(new EventEmitter(),{stderr:new EventEmitter(),kill:vi.fn(),send:vi.fn()});
    const failed=children.length===0;
    child.send.mockImplementation(()=>queueMicrotask(()=>failed?child.emit('exit',1):child.emit('message',{text:'VENDUTO',confidence:95})));
    children.push(child);return child;
  });
  const bytes=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();
  await expect(inspectSoldText(bytes)).rejects.toThrow('OCR exited');
  expect(children[0].kill).toHaveBeenCalledTimes(1);
  await expect(inspectSoldText(bytes)).resolves.toBe(true);
  expect(fake.spawn).toHaveBeenCalledTimes(2);
  await closeSoldTextWorker();
  expect(children[1].kill).toHaveBeenCalledTimes(1);
});
it('terminates a stalled OCR process after the deadline',async()=>{
 vi.useFakeTimers();
 let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const child=Object.assign(new EventEmitter(),{stderr:new EventEmitter(),kill:vi.fn(),send:vi.fn(()=>started())});
 fake.spawn.mockReturnValue(child);
 try {
  const bytes=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();
  const result=inspectSoldText(bytes);
  const assertion=expect(result).rejects.toThrow('exceeded 45 seconds');
  await ready;
  await vi.advanceTimersByTimeAsync(45_001);
  await assertion;
  expect(child.kill).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();await closeSoldTextWorker();}
});
