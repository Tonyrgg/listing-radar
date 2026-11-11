import {expect,it} from 'vitest';
import {classifySourceReading as quality} from '@/lib/source-reading-quality';
const now=Date.parse('2026-11-11T20:00:00Z');
it('does not present an old healthy source or partial sync as current and healthy',()=>{
  expect(quality('HEALTHY','SUCCEEDED','2026-11-10T19:59:00Z',now)).toBe('partial');
  expect(quality('HEALTHY','PARTIAL','2026-11-11T19:00:00Z',now)).toBe('partial');
  expect(quality('HEALTHY','SUCCEEDED',null,now)).toBe('partial');
  expect(quality(null,null,null,now)).toBe('unknown');
  expect(quality('HEALTHY','SUCCEEDED','2026-11-11T19:00:00Z',now)).toBe('healthy');
  expect(quality('FAILED','FAILED','2026-11-11T19:00:00Z',now)).toBe('broken');
});
