import {interactionId} from './interaction-id';
import {EventSchema} from '@ag-ui/core/schemas';
import {PROTOCOL_VERSION,type RunAgentInput} from '@ag-ui/core';
import {resultSchema} from './ag-ui-result';
import type {DynamicWorkspaceResponse} from './dynamic';
import type {WorkspaceContext,WorkspaceClarification} from './context';
import {workspaceContextSchema,contextFromResponse} from './context';
import {clarificationId} from './ag-ui';
import {WorkspaceRequestError} from './client-error';
export async function createAgentInput(prompt:string,context?:WorkspaceContext,clarification?:WorkspaceClarification,threadId=interactionId()):Promise<RunAgentInput>{
 const input:RunAgentInput={threadId,runId:interactionId(),protocolVersion:PROTOCOL_VERSION,messages:[{id:interactionId(),role:'user',content:prompt}],tools:[],context:[],state:{...(context?{workspace:context}:{}),...(clarification?{clarification}:{})}};
 if(clarification)input.resume=[{interruptId:await clarificationId(threadId,clarification.request,clarification.question),status:'resolved',payload:prompt}];
 return input;
}
const invalid=()=>new WorkspaceRequestError('The workspace stream was invalid. Your previous view has been kept. Please retry.','invalid_agent_stream');
export async function consumeWorkspaceStream(response:Response,input:Pick<RunAgentInput,'threadId'|'runId'>,onStage:(stage:string)=>void=()=>{},signal?:AbortSignal):Promise<DynamicWorkspaceResponse>{
 if(!response.ok){const payload=await response.json() as {error?:string;code?:string};throw new WorkspaceRequestError(payload.error??'The request could not start.',payload.code??'workspace_error');}
 if(!response.headers.get('Content-Type')?.includes('text/event-stream')||!response.body)throw invalid();
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',bytes=0,started=false,terminal=false,result:DynamicWorkspaceResponse|undefined,failure:WorkspaceRequestError|undefined;
 const event=(frame:string)=>{
  const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;
  const parsed=EventSchema.safeParse(JSON.parse(data));if(!parsed.success)throw invalid();const item=parsed.data;
  if(terminal)throw invalid();
  if(!started&&item.type!=='RUN_STARTED'&&item.type!=='RUN_ERROR')throw invalid();
  if(item.type==='RUN_STARTED'){if(started||item.threadId!==input.threadId||item.runId!==input.runId)throw invalid();started=true;}
  if(item.type==='STEP_STARTED')onStage(item.stepName);
  if(item.type==='RUN_ERROR'){terminal=true;failure=new WorkspaceRequestError(item.message,item.code??'workspace_error');}
  if(item.type==='RUN_FINISHED'){
   if(item.threadId!==input.threadId||item.runId!==input.runId)throw invalid();terminal=true;
   if(item.outcome?.type==='interrupt')failure=new WorkspaceRequestError(item.outcome.interrupts[0]?.message??'Please clarify your request.','unsupported_workspace_request');
   else if(item.outcome?.type==='cancelled')failure=new WorkspaceRequestError('Workspace generation was cancelled.','workspace_cancelled');
   else{const value=resultSchema.parse(item.result) as unknown as DynamicWorkspaceResponse;workspaceContextSchema.parse(contextFromResponse(value));result=value;}
  }
 };
 const abort=()=>{void reader.cancel();};signal?.addEventListener('abort',abort,{once:true});
 try{
  for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8_000_000)throw invalid();buffer+=decoder.decode(value,{stream:true});buffer=buffer.replaceAll('\r\n','\n');if(buffer.length>2_000_000)throw invalid();let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
  signal?.throwIfAborted();
  if(buffer.trim()||!terminal)throw new WorkspaceRequestError('The connection was interrupted before the workspace was ready. Please retry.','stream_interrupted');
  if(failure)throw failure;if(!result)throw invalid();return result;
 }catch(error){if(error instanceof WorkspaceRequestError||signal?.aborted)throw error;throw invalid();}
 finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
