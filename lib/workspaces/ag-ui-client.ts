import {interactionId} from './interaction-id';
import {EventSchema} from '@ag-ui/core/schemas';
import {PROTOCOL_VERSION,type RunAgentInput} from '@ag-ui/core';
import {resultSchema} from './ag-ui-result';
import type {DynamicWorkspaceResponse} from './dynamic';
import type {WorkspaceContext,WorkspaceClarification,WorkspaceReviewedDefinition} from './context';
import {workspaceContextSchema,contextFromResponse} from './context';
import {clarificationId,planReviewId} from './ag-ui';
import {workspacePlanReviewSchema,type WorkspacePlanReview} from './plan-review';
import {WorkspaceRequestError} from './client-error';
export type WorkspaceAgentOutcome={type:'workspace';response:DynamicWorkspaceResponse}|{type:'plan_review';review:WorkspacePlanReview};
export async function createAgentInput(prompt:string,context?:WorkspaceContext,clarification?:WorkspaceClarification,threadId=interactionId(),options?:{review?:boolean}):Promise<RunAgentInput>{
 const input:RunAgentInput={threadId,runId:interactionId(),protocolVersion:PROTOCOL_VERSION,messages:[{id:interactionId(),role:'user',content:prompt}],tools:[],context:[],state:{...(context?{workspace:context}:{}),...(clarification?{clarification}:{}),...(options?.review?{reviewRequested:true}:{})}};
 if(clarification)input.resume=[{interruptId:await clarificationId(threadId,clarification.request,clarification.question),status:'resolved',payload:prompt}];
 return input;
}
export async function createReviewedAgentInput(prompt:string,definition:WorkspaceReviewedDefinition,threadId=interactionId()):Promise<RunAgentInput>{
 const input=await createAgentInput(prompt,undefined,undefined,threadId);
 input.state={reviewedPlan:definition};
 input.resume=[{interruptId:await planReviewId(threadId,definition),status:'resolved',payload:'run'}];
 return input;
}
const invalid=()=>new WorkspaceRequestError('The workspace stream was invalid. Your previous view has been kept. Please retry.','invalid_agent_stream');
// Compatibility consumer for callers that only request completed workspaces.
export async function consumeWorkspaceStream(response:Response,input:Pick<RunAgentInput,'threadId'|'runId'>,onStage?:(stage:string)=>void,signal?:AbortSignal):Promise<DynamicWorkspaceResponse>{
 const outcome=await consumeWorkspaceAgent(response,input,onStage,signal);
 if(outcome.type==='plan_review')throw new WorkspaceRequestError('The plan is ready for review. Run it from the workspace conversation.','plan_review_required');
 return outcome.response;
}
export async function consumeWorkspaceAgent(response:Response,input:Pick<RunAgentInput,'threadId'|'runId'>,onStage:(stage:string)=>void=()=>{},signal?:AbortSignal):Promise<WorkspaceAgentOutcome>{
 if(!response.ok){const payload=await response.json() as {error?:string;code?:string};throw new WorkspaceRequestError(payload.error??'The request could not start.',payload.code??'workspace_error',response.headers.get('X-Morph-Request-Id')??undefined);}
 if(!response.headers.get('Content-Type')?.includes('text/event-stream')||!response.body)throw invalid();
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',bytes=0,started=false,terminal=false,result:WorkspaceAgentOutcome|undefined,failure:WorkspaceRequestError|undefined;
 const event=async(frame:string)=>{
  const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;
  const parsed=EventSchema.safeParse(JSON.parse(data));if(!parsed.success)throw invalid();const item=parsed.data;
  if(terminal)throw invalid();
  if(!started&&item.type!=='RUN_STARTED'&&item.type!=='RUN_ERROR')throw invalid();
  if(item.type==='RUN_STARTED'){if(started||item.threadId!==input.threadId||item.runId!==input.runId)throw invalid();started=true;}
  if(item.type==='STEP_STARTED')onStage(item.stepName);
  if(item.type==='RUN_ERROR'){terminal=true;failure=new WorkspaceRequestError(item.message,item.code??'workspace_error',typeof item.metadata?.requestId==='string'?item.metadata.requestId:undefined);}
  if(item.type==='RUN_FINISHED'){
   if(item.threadId!==input.threadId||item.runId!==input.runId)throw invalid();terminal=true;
   if(item.outcome?.type==='interrupt'){
    if(item.outcome.interrupts.length!==1)throw invalid();
    const interruption=item.outcome.interrupts[0];
    if(interruption.reason==='plan_review'){
     const review=workspacePlanReviewSchema.parse(interruption.metadata?.review);
     if(interruption.id!==await planReviewId(input.threadId,review.definition))throw invalid();
     result={type:'plan_review',review};
    }else if(interruption.reason==='input_required')failure=new WorkspaceRequestError(interruption.message??'Please clarify your request.','unsupported_workspace_request');
    else throw invalid();
   }
   else if(item.outcome?.type==='cancelled')failure=new WorkspaceRequestError('Workspace generation was cancelled.','workspace_cancelled');
   else{const value=resultSchema.parse(item.result) as unknown as DynamicWorkspaceResponse;workspaceContextSchema.parse(contextFromResponse(value));result={type:'workspace',response:value};}
  }
 };
 const abort=()=>{void reader.cancel();};signal?.addEventListener('abort',abort,{once:true});
 try{
  for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8_000_000)throw invalid();buffer+=decoder.decode(value,{stream:true});buffer=buffer.replaceAll('\r\n','\n');if(buffer.length>2_000_000)throw invalid();let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){await event(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
  signal?.throwIfAborted();
  if(buffer.trim()||!terminal)throw new WorkspaceRequestError('The connection was interrupted before the workspace was ready. Please retry.','stream_interrupted');
  if(failure)throw failure;if(!result)throw invalid();return result;
 }catch(error){if(error instanceof WorkspaceRequestError||signal?.aborted)throw error;throw invalid();}
 finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
