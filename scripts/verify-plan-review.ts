import assert from 'node:assert/strict';
import {createAgentInput,createReviewedAgentInput,consumeWorkspaceAgent} from '../lib/workspaces/ag-ui-client';
import type {RunAgentInput} from '@ag-ui/core';
import {WorkspaceRequestError} from '../lib/workspaces/client-error';

const endpoint=new URL(process.env.MORPH_BENCHMARK_URL??'https://invalid.example');
if(endpoint.protocol!=='https:'||endpoint.hostname==='invalid.example')throw new Error('Set MORPH_BENCHMARK_URL to the hosted HTTPS endpoint.');
endpoint.pathname='/api/workspaces/agent';
const threadId=crypto.randomUUID();
async function run(input:RunAgentInput,expectedStages:string[]){
 const started=performance.now(),stages:string[]=[];
 const signal=AbortSignal.timeout(45_000);
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Accept:'text/event-stream',Origin:endpoint.origin,...(process.env.MORPH_BENCHMARK_TOKEN?{'OAI-Sites-Authorization':`Bearer ${process.env.MORPH_BENCHMARK_TOKEN}`}:{})},body:JSON.stringify(input),signal});
 const outcome=await consumeWorkspaceAgent(response,input,stage=>stages.push(stage),signal);
 assert.deepEqual(stages,expectedStages);
 return {outcome,stages,durationMs:Math.round(performance.now()-started)};
}
try{
 const prompt='Show pending endorsements grouped by type. Count the requests. Normal table only.';
 const initial=await run(await createAgentInput(prompt,undefined,undefined,threadId,{review:true}),['catalogue','planning']);
 assert.equal(initial.outcome.type,'plan_review');if(initial.outcome.type!=='plan_review')throw new Error('Review missing');
 const definition=initial.outcome.review.definition;
 assert.equal(definition.context.plan.entity,'endorsements');assert.equal(definition.context.plan.groupBy,'type');
 assert.equal(definition.context.plan.analysis?.metricId,'endorsement_count');assert.deepEqual(definition.context.presentation.blocks,['table']);
 assert.ok(definition.context.plan.filters.some(filter=>filter.field==='status'));
 console.log(JSON.stringify({step:'review',passed:true,stages:initial.stages,durationMs:initial.durationMs}));

 const refined=await run(await createAgentInput('Keep the same count, grouping and filters. Show only a donut chart.',definition.context,undefined,threadId,{review:true}),['catalogue','planning']);
 assert.equal(refined.outcome.type,'plan_review');if(refined.outcome.type!=='plan_review')throw new Error('Revised review missing');
 const revised=refined.outcome.review.definition;
 assert.equal(revised.context.visualization,'donut');assert.deepEqual(revised.context.presentation.blocks,['chart']);
 assert.deepEqual(revised.context.plan.filters,definition.context.plan.filters);assert.deepEqual(revised.context.plan.analysis,definition.context.plan.analysis);
 console.log(JSON.stringify({step:'refine',passed:true,stages:refined.stages,durationMs:refined.durationMs}));

 const completed=await run(await createReviewedAgentInput(prompt,revised,threadId),['catalogue','authorization','rendering']);
 assert.equal(completed.outcome.type,'workspace');if(completed.outcome.type!=='workspace')throw new Error('Completed workspace missing');
 const workspace=completed.outcome.response;
 assert.deepEqual(workspace.queryPlan,revised.context.plan);assert.deepEqual(workspace.presentation,revised.context.presentation);
 assert.equal(workspace.planner?.mode,'reviewed_plan');assert.equal(workspace.gateway?.decision,'allow');
 assert.deepEqual(workspace.spec.blocks.map(block=>block.type==='chart'?block.variant:block.type),['donut']);
 console.log(JSON.stringify({step:'run_reviewed',passed:true,stages:completed.stages,durationMs:completed.durationMs}));
}catch(error){
 console.log(JSON.stringify({passed:false,code:error instanceof WorkspaceRequestError?error.code:error instanceof assert.AssertionError?'review_contract_mismatch':'verification_failed',...(error instanceof WorkspaceRequestError&&error.requestId?{requestId:error.requestId}:{})}));
 process.exitCode=1;
}
