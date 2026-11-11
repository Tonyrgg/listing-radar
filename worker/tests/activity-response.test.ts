import{it,expect}from'vitest';
import type{Response}from'playwright';
import{activityResponseText}from'../src/import-v2/activity-response.js';
it('bounds the wait for a streaming/broken activity response',async()=>{
 const response={text:()=>new Promise<string>(()=>{})}as Response;
 await expect(activityResponseText(response,20)).rejects.toThrow('non conclusa');
});
