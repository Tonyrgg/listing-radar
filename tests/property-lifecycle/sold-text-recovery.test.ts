import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
const fake = vi.hoisted(()=>({recognize:vi.fn(),terminate:vi.fn().mockResolvedValue(undefined),create:vi.fn()}));
vi.mock('tesseract.js',()=>({createWorker:fake.create}));
import { inspectSoldText, closeSoldTextWorker } from '@/lib/property-lifecycle/assets/sold-text';
it('terminates a failed OCR worker and starts a fresh one for the next photo',async()=>{
  fake.create.mockResolvedValue({recognize:fake.recognize,terminate:fake.terminate});
  fake.recognize.mockRejectedValueOnce(new Error('OCR failed')).mockResolvedValueOnce({data:{text:'VENDUTO',confidence:95}});
  const bytes=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();
  await expect(inspectSoldText(bytes)).rejects.toThrow('OCR failed');
  expect(fake.terminate).toHaveBeenCalledTimes(1);
  await expect(inspectSoldText(bytes)).resolves.toBe(true);
  expect(fake.create).toHaveBeenCalledTimes(2);
  expect(fake.create.mock.calls[0][2].errorHandler).toBeTypeOf('function');
  await closeSoldTextWorker();
});
