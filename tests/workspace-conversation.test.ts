import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startConversation,appendAssistantMessage,continueClarification} from '../lib/workspaces/conversation';
test('follow-ups retain the existing conversation but new workspaces start fresh',()=>{
 const initial=appendAssistantMessage(startConversation([],'Show policies',false),'Built a policy table.');
 assert.equal(startConversation(initial,'Make this a donut',true).length,3);
 assert.equal(startConversation(initial,'Show claims',false).length,1);
});
test('failures and cancellation stay in the transcript without claiming a successful change',()=>{
 const pending=startConversation([],'Make this a donut',false);
 const error=appendAssistantMessage(pending,'Which measure should I use?','error');
 assert.equal(error[1].kind,'error');assert.equal(error[0].content,'Make this a donut');
 const cancelled=appendAssistantMessage(error,'Cancelled. Your previous workspace is unchanged.','cancelled');
 assert.equal(cancelled[2].kind,'cancelled');
});
test('a long workspace conversation is bounded in memory',()=>{
 let messages=startConversation([],'Show policies',false);
 for(let i=0;i<100;i++)messages=appendAssistantMessage(messages,`Update ${i}`);
 assert.equal(messages.length,40);assert.equal(messages.at(-1)?.content,'Update 99');
});

test('multiple clarification answers retain the original request and bounded answer history',()=>{
 const first=continueClarification(undefined,'Show premium growth','Which period?');
 const second=continueClarification(first,'January to March 2026','Which date basis?');
 assert.equal(second.request,'Show premium growth');assert.deepEqual(second.answers,['January to March 2026']);
 let next=second;for(let i=0;i<10;i++)next=continueClarification(next,`Answer ${i}`,'Please clarify');
 assert.equal(next.answers?.length,6);assert.equal(next.request,'Show premium growth');
});
