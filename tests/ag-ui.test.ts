import assert from 'node:assert/strict';
import {test} from 'node:test';
import {POST} from '../app/api/workspaces/agent/route';
import {consumeWorkspaceStream, createAgentInput} from '../lib/workspaces/ag-ui-client';
const request=(body:unknown,origin='http://localhost')=>new Request('http://localhost/api/workspaces/agent',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Accept:'text/event-stream'},body:JSON.stringify(body)});
test('AG-UI runs the existing authorized pipeline and reports actual steps',async()=>{
 const input=await createAgentInput('Show pending endorsements grouped by type. Table only.');
 const response=await POST(request(input));assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')!,/event-stream/);
 const steps:string[]=[];const result=await consumeWorkspaceStream(response,input,stage=>steps.push(stage));
 assert.equal(result.intent,'endorsements');assert.deepEqual(result.spec.blocks.map(b=>b.type),['table']);assert.deepEqual(steps,['catalogue','planning','authorization','rendering']);
});
test('AG-UI rejects cross-origin input before opening a stream',async()=>{
 const response=await POST(request(await createAgentInput('Show all policies'),'https://evil.example'));assert.equal(response.status,403);assert.doesNotMatch(response.headers.get('Content-Type')!,/event-stream/);
});
test('AG-UI cannot accept arbitrary frontend tools or result rows as shared state',async()=>{
 const input=await createAgentInput('Show all policies');input.state={rows:[{secret:'customer'}]};
 assert.equal((await POST(request(input))).status,400);
 input.state={};input.tools=[{name:'sql',description:'sql',parameters:{}}];assert.equal((await POST(request(input))).status,400);
});
test('unsupported requests interrupt into chat and carry no customer data',async()=>{
 const input=await createAgentInput('Plan an office lunch for tomorrow');
 const response=await POST(request(input));const text=await response.text();assert.match(text,/input_required/);assert.doesNotMatch(text,/"records"|"rows"/);
 await assert.rejects(consumeWorkspaceStream(new Response(text,{headers:{'Content-Type':'text/event-stream'}}),input),error=>error instanceof Error&&error.message.length>0);
});
test('a truncated or mismatched stream never commits a result',async()=>{
 const input=await createAgentInput('Show all policies');
 const stream=(events:unknown[])=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(consumeWorkspaceStream(stream([{type:'RUN_STARTED',threadId:input.threadId,runId:input.runId}]),input),/interrupted/i);
 await assert.rejects(consumeWorkspaceStream(stream([{type:'RUN_STARTED',threadId:'wrong',runId:input.runId}]),input),/invalid/i);
});
test('clarification resume is linked to the question and thread, then revalidated',async()=>{
 const {parseAgentRequest}=await import('../lib/workspaces/ag-ui');
 const clarification={request:'Show premium growth',question:'Which dataset and period?'};
 const input=await createAgentInput('Policies, this year',undefined,clarification,'thread-resume');
 const parsed=await parseAgentRequest(input);assert.equal(parsed.input.clarification?.request,clarification.request);
 input.threadId='other-thread';await assert.rejects(parseAgentRequest(input),/Invalid clarification/);
});
test('provider configuration failure becomes RUN_ERROR, never a successful HTTP200 workspace',async t=>{
 const names=['MORPH_ALLOW_RULE_BASED_PLANNER','MORPH_AI_PLANNER_ENABLED','OPENAI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'];const previous=names.map(name=>process.env[name]);
 for(const name of names)delete process.env[name];t.after(()=>names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];}));
 const input=await createAgentInput('Show all policies');const response=await POST(request(input));
 assert.equal(response.status,200);await assert.rejects(consumeWorkspaceStream(response,input),error=>error instanceof Error&&/configur/i.test(error.message));
});
test('consumer abort stops waiting and cannot apply any partial response',async()=>{
 const input=await createAgentInput('Show all policies');const abort=new AbortController();
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:'RUN_STARTED',threadId:input.threadId,runId:input.runId})}\n\n`));}});
 const pending=consumeWorkspaceStream(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),input,()=>{},abort.signal);abort.abort();
 await assert.rejects(pending,error=>error instanceof Error&&error.name==='AbortError');
});
test('conversation identifiers work in the HTTP-only preview without randomUUID',async()=>{
 const {interactionId}=await import('../lib/workspaces/interaction-id');
 const descriptor=Object.getOwnPropertyDescriptor(crypto,'randomUUID');Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});
 try{assert.match(interactionId(),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);}finally{if(descriptor)Object.defineProperty(crypto,'randomUUID',descriptor);else delete (crypto as unknown as {randomUUID?:unknown}).randomUUID;}
});
