import assert from 'node:assert/strict';
import {test,beforeEach} from 'node:test';
import {POST} from '../app/api/workspaces/generate/route';
import {generateWorkspaceResponse} from '../lib/server/workspace-generation';
import {stubReviewPlanner} from './helpers/review-planner';
beforeEach(async()=>{
 const {env}=await import('cloudflare:workers');
 await (env as unknown as {DB:{prepare:(sql:string)=>{run:()=>Promise<unknown>}}}).DB.prepare('DELETE FROM request_limits').run();
});

const request=(body:unknown)=>new Request('http://localhost/api/workspaces/generate',{
  method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify(body),
});
const prompt='Show pending endorsements grouped by type. Table only.';
async function review(){
  const response=await POST(request({prompt,action:'review'}));
  assert.equal(response.status,200);
  return response.json();
}

test('review returns the interpretation and definition before execution, without rows or a success record',async t=>{
  stubReviewPlanner(t);
  const {env}=await import('cloudflare:workers');
  const db=(env as unknown as {DB:{prepare:(sql:string)=>{first:()=>Promise<{n:number}>}}}).DB;
  const before=await db.prepare('SELECT count(*) AS n FROM workspace_runs').first();
  const stages:string[]=[];
  const response=await generateWorkspaceResponse(request({prompt,action:'review'}),stage=>stages.push(stage));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.type,'plan_review');
  assert.equal(payload.definition.context.plan.entity,'endorsements');
  assert.equal(payload.definition.context.plan.groupBy,'type');
  assert.deepEqual(payload.definition.context.presentation.blocks,['table']);
  assert.match(payload.summary.format,/table/i);
  assert.deepEqual(stages,['catalogue','planning']);
  assert.equal(payload.spec,undefined);assert.equal(payload.rows,undefined);assert.equal(payload.gateway,undefined);
  assert.deepEqual(await db.prepare('SELECT count(*) AS n FROM workspace_runs').first(),before);
});

test('running a reviewed definition skips the AI and executes exactly that approved query',async t=>{
  stubReviewPlanner(t);
  const payload=await review();
  const names=['MORPH_ALLOW_RULE_BASED_PLANNER','MORPH_AI_PLANNER_ENABLED','OPENAI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'];
  const previous=names.map(name=>process.env[name]);
  for(const name of names)delete process.env[name];
  t.after(()=>names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];}));
  const stages:string[]=[];
  const response=await generateWorkspaceResponse(request({prompt,action:'run_reviewed',reviewedPlan:payload.definition}),stage=>stages.push(stage));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.queryPlan,payload.definition.context.plan);
  assert.deepEqual(result.presentation,payload.definition.context.presentation);
  assert.deepEqual(result.spec.blocks.map((block:{type:string})=>block.type),['table']);
  assert.equal(result.planner.mode,'reviewed_plan');
  assert.equal(result.gateway.decision,'allow');
  assert.deepEqual(stages,['catalogue','authorization','rendering']);
});

test('reviewed definitions are untrusted and cannot retain stale catalogue or prohibited fields',async t=>{
  stubReviewPlanner(t);
  const payload=await review();
  for(const mutation of [
    (d:typeof payload.definition)=>{d.context.plan.catalogVersion='stale';},
    (d:typeof payload.definition)=>{d.context.plan.fields.push('database_password');},
    (d:typeof payload.definition)=>{d.context.plan.rowLimit=201;},
    (d:typeof payload.definition)=>{d.context.plan.source='other_database';},
    (d:typeof payload.definition)=>{d.context.visualization='donut';d.context.presentation.blocks=['chart'];d.context.plan.analysis=undefined;},
  ]){
    const definition=structuredClone(payload.definition);mutation(definition);
    const stages:string[]=[];
    const response=await generateWorkspaceResponse(request({prompt,action:'run_reviewed',reviewedPlan:definition}),stage=>stages.push(stage));
    assert.equal(response.status,400);assert.equal(stages.includes('authorization'),false);
    const result=await response.json();assert.equal(result.spec,undefined);
  }
});

test('normal generation stays immediate and review execution cannot silently replan',async t=>{
  stubReviewPlanner(t);
  const response=await POST(request({prompt}));assert.equal(response.status,200);
  const result=await response.json();assert.ok(result.spec);assert.equal(result.type,undefined);
  assert.equal((await POST(request({prompt,action:'run_reviewed'}))).status,400);
  const payload=await review();
  assert.equal((await POST(request({prompt,action:'review',reviewedPlan:payload.definition}))).status,400);
});

test('a review can be refined in chat without fetching records, then run in the revised format',async t=>{
 const model=stubReviewPlanner(t);
 const initial=await review();
 model.setProposal({visualization:'donut',presentation:{blocks:['chart'],tableLayout:'grouped_summary'}});
 const response=await POST(request({prompt:'Show the same count and filters as a donut chart only.',action:'review',context:initial.definition.context}));
 assert.equal(response.status,200);
 const revised=await response.json();assert.equal(revised.type,'plan_review');
 assert.deepEqual(revised.definition.context.plan.filters,initial.definition.context.plan.filters);
 assert.deepEqual(revised.definition.context.plan.analysis,initial.definition.context.plan.analysis);
 assert.deepEqual(revised.definition.context.presentation.blocks,['chart']);
 assert.equal(revised.definition.context.visualization,'donut');
 const result=await POST(request({prompt:'Run',action:'run_reviewed',reviewedPlan:revised.definition}));
 assert.equal(result.status,200);
 const workspace=await result.json();assert.deepEqual(workspace.spec.blocks.map((block:{type:string;variant?:string})=>[block.type,block.variant]),[['chart','donut']]);
 assert.equal(model.calls(),2);
});

test('a reviewed definition loses validity when currently approved fields or datasets change',async t=>{
 stubReviewPlanner(t);
 const {validateReviewedPlan}=await import('../lib/server/reviewed-plan');
 const {insuranceSemanticCatalog}=await import('../lib/catalog/semantic');
 const payload=await review();
 const changed=structuredClone(insuranceSemanticCatalog);
 changed.entities.find(entity=>entity.entity==='endorsements')!.fields.find(field=>field.name==='type')!.groupable=false;
 assert.throws(()=>validateReviewedPlan(payload.definition,changed));
 changed.entities=changed.entities.filter(entity=>entity.entity!=='endorsements');
 assert.throws(()=>validateReviewedPlan(payload.definition,changed));
 const capped=structuredClone(insuranceSemanticCatalog);
 capped.entities.find(entity=>entity.entity==='endorsements')!.maximumRows=50;
 assert.throws(()=>validateReviewedPlan(payload.definition,capped));
});
