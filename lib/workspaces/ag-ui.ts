import {z} from 'zod';
import {RunAgentInputSchema} from '@ag-ui/core/schemas';
import {workspaceContextSchema,workspaceClarificationSchema,workspaceReviewedDefinitionSchema,type WorkspaceReviewedDefinition} from './context';
import {dynamicWorkspaceRequestSchema} from './dynamic';
export const stageLabels:Record<string,string>={connecting:'Starting a secure request',catalogue:'Checking available datasets',planning:'Understanding your request',authorization:'Checking permissions and fetching data',rendering:'Preparing your workspace'};
export const sharedStateSchema=z.object({workspace:workspaceContextSchema.optional(),clarification:workspaceClarificationSchema.optional(),reviewRequested:z.literal(true).optional(),reviewedPlan:workspaceReviewedDefinitionSchema.optional()}).strict();
export async function planReviewId(threadId:string,definition:WorkspaceReviewedDefinition){
 const canonical=workspaceReviewedDefinitionSchema.parse(definition);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([threadId,canonical])));
 return 'review-'+Array.from(new Uint8Array(bytes)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function clarificationId(threadId:string,request:string,question:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([threadId,request,question])));
 return 'clarify-'+Array.from(new Uint8Array(bytes)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function parseAgentRequest(raw:unknown){
 const run=RunAgentInputSchema.parse(raw);
 if(run.threadId.length>100||run.runId.length>100||run.messages.length!==1||run.tools.length||run.context.length)throw new Error('Unsupported agent input');
 const message=run.messages[0];
 if(message.role!=='user'||typeof message.content!=='string')throw new Error('Send one text request');
 const state=sharedStateSchema.parse(run.state??{});
 if(state.reviewedPlan){
  const expected=await planReviewId(run.threadId,state.reviewedPlan);
  if(state.workspace||state.clarification||state.reviewRequested||run.resume?.length!==1||run.resume[0].interruptId!==expected||run.resume[0].status!=='resolved'||run.resume[0].payload!=='run')throw new Error('Invalid plan review response');
 }else if(state.clarification){
  const expected=await clarificationId(run.threadId,state.clarification.request,state.clarification.question);
  if(run.resume?.length!==1||run.resume[0].interruptId!==expected||run.resume[0].status!=='resolved'||run.resume[0].payload!==message.content)throw new Error('Invalid clarification response');
 }else if(run.resume?.length)throw new Error('No clarification is pending');
 const input=dynamicWorkspaceRequestSchema.parse({prompt:message.content,limit:200,context:state.workspace,clarification:state.clarification,action:state.reviewedPlan?'run_reviewed':state.reviewRequested?'review':'generate',reviewedPlan:state.reviewedPlan});
 return {run,input,state};
}
