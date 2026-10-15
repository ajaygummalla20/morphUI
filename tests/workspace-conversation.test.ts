import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startConversation,appendAssistantMessage,continueClarification,clarificationForReply} from '../lib/workspaces/conversation';
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

test('initial clarification renders a usable chat without a generated workspace',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {WorkspaceConversation}=await import('../app/components/workspace-conversation');
 const messages=appendAssistantMessage(startConversation([],'Show premium growth',false),'Which date basis and period should I use?','error');
 const html=renderToStaticMarkup(createElement(WorkspaceConversation,{response:null,messages,onFollowup:()=>{},busy:false,onCancel:()=>{},onRetry:()=>{},error:'Which date basis and period should I use?',needsClarification:true}));
 assert.match(html,/Which date basis and period should I use/);assert.match(html,/Reply below to clarify/);assert.match(html,/Send message/);
 assert.doesNotMatch(html,/last successful workspace is still visible|Donut chart|Refresh<|Table only/);
});

test('initial replies and replies after cancellation or provider failure retain the pending question',()=>{
 const initial=clarificationForReply(undefined,'Show premium growth','Which period?');
 assert.equal(initial?.request,'Show premium growth');
 const next=clarificationForReply(initial,'January to March 2026',null);
 assert.equal(next?.request,'Show premium growth');assert.equal(next?.question,'Which period?');assert.deepEqual(next?.answers,['January to March 2026']);
 assert.equal(clarificationForReply(undefined,'Unrelated request',null),undefined);
});
