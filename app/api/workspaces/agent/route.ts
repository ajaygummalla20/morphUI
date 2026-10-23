import {resultSchema} from '@/lib/workspaces/ag-ui-result';
import type {DynamicWorkspaceResponse} from '@/lib/workspaces/dynamic';
import {z} from 'zod';
import {EventEncoder} from '@ag-ui/encoder';
import {EventType,PROTOCOL_VERSION,type Event} from '@ag-ui/core';
import {guardRequest} from '@/lib/auth/session';
import {readJsonLimited,securityResponse} from '@/lib/server/security';
import {parseAgentRequest,clarificationId,planReviewId} from '@/lib/workspaces/ag-ui';
import {workspacePlanReviewSchema} from '@/lib/workspaces/plan-review';
import {generateWorkspaceResponse} from '@/lib/server/workspace-generation';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const requestId=crypto.randomUUID();
 let session,parsed;
 try{
  request.signal.throwIfAborted();
  session=await guardRequest(request,'generate','viewer',12);
  parsed=await parseAgentRequest(await readJsonLimited(request));
 }catch(error){return securityResponse(error)??Response.json({error:'The conversation request is invalid. Start a new request.',code:'invalid_agent_request'},{status:400,headers:{'Cache-Control':'no-store'}});}
 const {run,input,state}=parsed;
 const encoder=new EventEncoder({accept:'text/event-stream'}),utf8=new TextEncoder();
 const abort=new AbortController();
 const abortRequest=()=>abort.abort();request.signal.addEventListener('abort',abortRequest,{once:true});
 if(request.signal.aborted)abort.abort();
 const executionRequest=new Request(request.url,{method:'POST',headers:request.headers,signal:abort.signal});
 const stream=new ReadableStream<Uint8Array>({
  async start(controller){
   let closed=false,step:string|undefined;
   const emit=(event:Event)=>{if(!closed&&!abort.signal.aborted)controller.enqueue(utf8.encode(encoder.encode(event)));};
   const text=(message:string)=>{const messageId=crypto.randomUUID();emit({type:EventType.TEXT_MESSAGE_START,messageId,role:'assistant'});emit({type:EventType.TEXT_MESSAGE_CONTENT,messageId,delta:message});emit({type:EventType.TEXT_MESSAGE_END,messageId});};
   const closeStep=()=>{if(step){emit({type:EventType.STEP_FINISHED,stepName:step});step=undefined;}};
   try{
    emit({type:EventType.RUN_STARTED,threadId:run.threadId,runId:run.runId,protocolVersion:PROTOCOL_VERSION});
    const response=await generateWorkspaceResponse(executionRequest,stage=>{closeStep();step=stage;emit({type:EventType.STEP_STARTED,stepName:stage});},session,input);
    const rawPayload=await response.json();closeStep();
    if(abort.signal.aborted)return;
    if(response.ok){
     const reviewResult=workspacePlanReviewSchema.safeParse(rawPayload);
     if(reviewResult.success){
      const review=reviewResult.data;
      const id=await planReviewId(run.threadId,review.definition);
      emit({type:EventType.STATE_SNAPSHOT,snapshot:{reviewedPlan:review.definition}});
      text('Your plan is ready to review. No result records have been fetched. Run it or ask for a change.');
      emit({type:EventType.RUN_FINISHED,threadId:run.threadId,runId:run.runId,outcome:{type:'interrupt',interrupts:[{id,reason:'plan_review',message:'Review this plan before fetching data.',metadata:{review},responseSchema:{type:'string',enum:['run']}}]}});
     }else{
     const payload=resultSchema.parse(rawPayload) as unknown as DynamicWorkspaceResponse;
     // Keep only definitions in shared state. Authorized result data travels once, in the final result.
     const {contextFromResponse}=await import('@/lib/workspaces/context');
     emit({type:EventType.STATE_SNAPSHOT,snapshot:{workspace:contextFromResponse(payload)}});
     text(payload.interpretation);
     emit({type:EventType.RUN_FINISHED,threadId:run.threadId,runId:run.runId,outcome:{type:'success'},result:payload});
     }
    }else {
     const payload=z.object({error:z.string(),code:z.string(),requestId:z.string().uuid().optional()}).parse(rawPayload);
     if(payload.code==='unsupported_workspace_request'){
     const clarification={request:state.clarification?.request??input.prompt,question:payload.error,...(state.clarification?{answers:[...(state.clarification.answers??[]),input.prompt].slice(-6)}:{})};
     const id=await clarificationId(run.threadId,clarification.request,clarification.question);
     emit({type:EventType.STATE_SNAPSHOT,snapshot:{...(state.workspace?{workspace:state.workspace}:{}),clarification}});
     text(payload.error);
     emit({type:EventType.MESSAGES_SNAPSHOT,messages:[...run.messages,{id:crypto.randomUUID(),role:'assistant',content:payload.error}]});
     emit({type:EventType.RUN_FINISHED,threadId:run.threadId,runId:run.runId,outcome:{type:'interrupt',interrupts:[{id,reason:'input_required',message:payload.error,responseSchema:{type:'string',minLength:1,maxLength:500}}]}});
    }else {
      const reference=payload.requestId??requestId;
      console.error(JSON.stringify({type:'morph_agent_error',requestId:reference,entryPoint:'/api/workspaces/agent',code:/^[a-z0-9_]{1,64}$/.test(payload.code)?payload.code:'workspace_error'}));
      emit({type:EventType.RUN_ERROR,message:payload.error,code:payload.code,metadata:{requestId:reference}});
     }
    }
   }catch{
    if(!abort.signal.aborted){
     console.error(JSON.stringify({type:'morph_agent_error',requestId,entryPoint:'/api/workspaces/agent',code:'stream_error'}));
     emit({type:EventType.RUN_ERROR,message:'The workspace stream was interrupted. Please retry.',code:'stream_error',metadata:{requestId}});
    }
   }finally{closed=true;request.signal.removeEventListener('abort',abortRequest);try{controller.close();}catch{/* Reader cancelled. */}}
  },
  cancel(){abort.abort();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'}});
}
