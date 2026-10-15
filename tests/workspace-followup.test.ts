import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planWorkspaceRequestWithAi,type AiWorkspaceProposal} from '../lib/workspaces/ai-planner';
import {dynamicWorkspaceRequestSchema} from '../lib/workspaces/dynamic';
import {insuranceSemanticCatalog} from '../lib/catalog/semantic';
import {workspaceContextSchema} from '../lib/workspaces/context';
const context=workspaceContextSchema.parse({plan:{source:insuranceSemanticCatalog.entities.find(e=>e.entity==='policies')!.source,catalogVersion:insuranceSemanticCatalog.catalogVersion,operation:'select',entity:'policies',fields:['total_premium','relationship_manager'],filters:[{field:'total_premium',operator:'greater_than',value:20000}],groupBy:'relationship_manager',orderBy:[],rowLimit:200,analysis:{metricId:'written_premium',time:null,comparison:'none'}},presentation:{mode:'table_only',blocks:['table'],tableLayout:'grouped_summary'},chartValue:'value'});
const proposal:AiWorkspaceProposal={supported:true,intent:'policies',entity:'policies',title:'Premium by manager',interpretation:'Same premium filter in a donut chart.',fields:['total_premium','relationship_manager'],filters:context.plan.filters,groupBy:'relationship_manager',orderBy:[],metricIds:[],analysis:context.plan.analysis,visualization:'donut',presentation:{blocks:['chart'],tableLayout:'grouped_summary'},unsupportedReason:''};
test('follow-ups accept bounded query definitions but never result rows',()=>{
 assert.ok(dynamicWorkspaceRequestSchema.parse({prompt:'Make this a donut chart only.',context}).context);
 assert.throws(()=>dynamicWorkspaceRequestSchema.parse({prompt:'Make this a donut chart only.',context:{...context,records:[{customer:'private'}]}}));
});
test('presentation follow-ups preserve filters and provide context to model',async()=>{
 let received=false;
 const result=await planWorkspaceRequestWithAi('Make this a donut chart only.',insuranceSemanticCatalog,200,{context,generateProposal:async input=>{received=!!input.context;return proposal;}});
 assert.ok(received);assert.deepEqual(result.plan.filters,context.plan.filters);assert.deepEqual(result.plan.presentation.blocks,['chart']);
});
test('an accidental dropped filter is rejected and corrected before any execution',async()=>{
 let attempts=0;
 const result=await planWorkspaceRequestWithAi('Make this a donut chart only.',insuranceSemanticCatalog,200,{context,generateProposal:async()=>++attempts===1?{...proposal,filters:[]}:proposal});
 assert.equal(attempts,2);assert.deepEqual(result.plan.filters,context.plan.filters);
});
test('explicit model-declared filter changes allow a follow-up to refine the query',async()=>{
 const result=await planWorkspaceRequestWithAi('Change the premium threshold to 30000.',insuranceSemanticCatalog,200,{context,generateProposal:async()=>({...proposal,changedFilterFields:['total_premium'],filters:[{field:'total_premium',operator:'greater_than',value:30000}]})});
 assert.equal(result.plan.filters[0].value,30000);
});
test('unavailable context fields fail before provider execution',async()=>{
 let calls=0;
 await assert.rejects(planWorkspaceRequestWithAi('Make this a donut chart only.',insuranceSemanticCatalog,200,{context:{...context,plan:{...context.plan,fields:['database_password']}},generateProposal:async()=>{calls++;return proposal;}}));
 assert.equal(calls,0);
});

test('provider failure cannot fall back to a different query during a follow-up',async()=>{
 await assert.rejects(planWorkspaceRequestWithAi('Make this a donut chart only.',insuranceSemanticCatalog,200,{context,allowFallback:true,generateProposal:async()=>{throw {statusCode:429};}}),/quota|rate limit/i);
});

test('record drill-down keeps filters and replaces the aggregate with individual records',async()=>{
 const result=await planWorkspaceRequestWithAi('List individual records for the selected relationship manager, keeping all other filters. Table only without totals.',insuranceSemanticCatalog,200,{context,generateProposal:async()=>({...proposal,analysis:null,groupBy:null,visualization:'table',fields:['policy_number','total_premium','relationship_manager'],changedFilterFields:['relationship_manager'],filters:[...context.plan.filters,{field:'relationship_manager',operator:'equals',value:'Priya Shah'}],presentation:{blocks:['table'],tableLayout:'records'}})});
 assert.equal(result.plan.analysis,undefined);assert.equal(result.plan.presentation.tableLayout,'records');assert.deepEqual(result.plan.filters[0],context.plan.filters[0]);
});

test('unannounced new filters cannot silently narrow a follow-up',async()=>{
 let attempts=0;
 const result=await planWorkspaceRequestWithAi('Make this a donut chart only.',insuranceSemanticCatalog,200,{context,generateProposal:async()=>++attempts===1?{...proposal,filters:[...context.plan.filters,{field:'status',operator:'equals',value:'active'}]}:proposal});
 assert.equal(attempts,2);assert.deepEqual(result.plan.filters,context.plan.filters);
});

test('a clarification answer carries the unresolved request and question without rows',async()=>{
 const clarification={request:'Show premium growth.',question:'Which date basis and period should I use?'};
 const parsed=dynamicWorkspaceRequestSchema.parse({prompt:'January to March 2026, monthly, coverage start date.',context,clarification});
 assert.deepEqual(parsed.clarification,clarification);
 let received=false;
 await planWorkspaceRequestWithAi(parsed.prompt,insuranceSemanticCatalog,200,{context,clarification,generateProposal:async input=>{received=input.clarification?.request===clarification.request;return proposal;}});
 assert.ok(received);
 assert.throws(()=>dynamicWorkspaceRequestSchema.parse({...parsed,clarification:{...clarification,rows:[{customer:'private'}]}}));
});

test('short conversational answers are allowed with context while initial requests remain descriptive',()=>{
 assert.equal(dynamicWorkspaceRequestSchema.parse({prompt:'Count',context}).prompt,'Count');
 assert.equal(dynamicWorkspaceRequestSchema.parse({prompt:'Yes',context,clarification:{request:'Count',question:'Should I use a count?'}}).prompt,'Yes');
 assert.throws(()=>dynamicWorkspaceRequestSchema.parse({prompt:'Yes'}));
 assert.throws(()=>dynamicWorkspaceRequestSchema.parse({prompt:' ',context}));
});

test('short follow-up workspaces can be saved with definitions, but not as bare ambiguous prompts',async()=>{
 const {POST}=await import('../app/api/app-state/route');
 const id=crypto.randomUUID();
 const workspace={id,title:'Policy count',prompt:'Count',savedAt:new Date().toISOString(),data:null,pinned:false,definition:{...context,plan:{...context.plan,analysis:{metricId:'policy_count',time:null,comparison:'none'}}}};
 const request=(body:unknown)=>new Request('https://morph.example/api/app-state',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://morph.example'},body:JSON.stringify(body)});
 const response=await POST(request({action:'save_workspace',workspace}));assert.equal(response.status,200);
 assert.equal((await POST(request({action:'save_workspace',workspace:{...workspace,id:crypto.randomUUID(),definition:undefined}}))).status,400);
 assert.equal((await POST(request({action:'update_workspace',id,delete:true}))).status,200);
});

test('initial clarification replies never fall back to interpreting the answer alone',async()=>{
 await assert.rejects(planWorkspaceRequestWithAi('Monthly',insuranceSemanticCatalog,200,{allowFallback:true,clarification:{request:'Show premium growth',question:'Which period?'},generateProposal:async()=>{throw {statusCode:429};}}),/quota|rate limit/i);
});
