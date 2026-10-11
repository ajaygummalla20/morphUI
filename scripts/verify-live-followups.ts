import assert from 'node:assert/strict';
import {contextFromResponse} from '../lib/workspaces/context';
import type {DynamicWorkspaceResponse} from '../lib/workspaces/dynamic';
import type {AppStateBootstrap} from '../lib/app-state/types';
// Synthetic requests; output only scenario IDs and pass/fail, never rows/tokens.
const endpoint=new URL(process.env.MORPH_BENCHMARK_URL??'');
if(endpoint.protocol!=='https:')throw new Error('Use a deployed HTTPS endpoint.');
const headers:Record<string,string>={'Content-Type':'application/json',Origin:endpoint.origin};
if(process.env.MORPH_BENCHMARK_TOKEN)headers['OAI-Sites-Authorization']=`Bearer ${process.env.MORPH_BENCHMARK_TOKEN}`;
async function call(path:string,body?:unknown){
 const response=await fetch(new URL(path,endpoint),{method:body?'POST':'GET',redirect:'error',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45_000)});
 assert.ok(response.ok,`HTTP ${response.status}`);return response.json();
}
let passed=0;const created:string[]=[];
const report=(id:string)=>{passed++;console.log(JSON.stringify({id,passed:true}));};
try{
 const base=await call(endpoint.pathname,{prompt:'Show total written premium by relationship manager for policies with premium above 20000. Normal table only.',limit:200}) as DynamicWorkspaceResponse;
 const context=contextFromResponse(base);assert.equal(base.queryPlan.analysis?.metricId,'written_premium');assert.equal(base.presentation?.tableLayout,'grouped_summary');report('base-table');
 const donut=await call(endpoint.pathname,{prompt:'Make this a donut chart only.',context,limit:200}) as DynamicWorkspaceResponse;
 assert.deepEqual(donut.queryPlan.filters,base.queryPlan.filters);assert.equal(donut.spec.blocks.length,1);assert.equal(donut.spec.blocks[0].type,'chart');assert.equal(donut.spec.blocks[0].type==='chart'&&donut.spec.blocks[0].variant,'donut');report('followup-preserves-filters');
 const refreshed=await call(endpoint.pathname,{prompt:'Refresh this workspace without changing its query or display.',context:contextFromResponse(donut),limit:200}) as DynamicWorkspaceResponse;
 assert.deepEqual(refreshed.queryPlan.filters,donut.queryPlan.filters);assert.equal(refreshed.spec.blocks[0].type==='chart'&&refreshed.spec.blocks[0].variant,'donut');report('refresh-preserves-donut');
 const changed=await call(endpoint.pathname,{prompt:'Change the premium threshold to above 30000. Keep everything else.',context:contextFromResponse(donut),limit:200}) as DynamicWorkspaceResponse;
 assert.ok(changed.queryPlan.filters.some(filter=>filter.field==='total_premium'&&filter.operator==='greater_than'&&filter.value===30000));report('intentional-filter-edit');
 const chart=donut.spec.blocks.find(block=>block.type==='chart');const group=chart?.type==='chart'?chart.items[0]?.drilldownValue:undefined;assert.ok(group);
 const records=await call(endpoint.pathname,{prompt:`List individual records where relationship_manager equals ${JSON.stringify(group)}, keeping all other filters. Table only, without totals.`,context:contextFromResponse(donut),limit:200}) as DynamicWorkspaceResponse;
 assert.equal(records.queryPlan.analysis,undefined);assert.equal(records.presentation?.tableLayout,'records');assert.ok(records.queryPlan.filters.some(filter=>filter.field==='relationship_manager'&&filter.value===group));assert.ok(records.queryPlan.filters.some(filter=>filter.field==='total_premium'&&filter.value===20000));report('chart-drilldown');
 const id=crypto.randomUUID(),title=`Synthetic verification ${id}`;created.push(id);
 await call('/api/app-state',{action:'save_workspace',workspace:{id,title,prompt:'Saved synthetic premium donut',savedAt:new Date().toISOString(),data:null,pinned:false,definition:contextFromResponse(donut)}});
 await call('/api/app-state',{action:'update_workspace',id,title:`${title} renamed`});
 await call('/api/app-state',{action:'duplicate_workspace',id});
 const state=await call('/api/app-state') as AppStateBootstrap;
 const copies=state.savedWorkspaces.filter(item=>item.title.startsWith(title));for(const item of copies)if(!created.includes(item.id))created.push(item.id);
 assert.equal(copies.length,2);for(const item of copies){assert.equal(item.data,null);assert.equal(item.definition?.visualization,'donut');assert.deepEqual(item.definition?.plan.filters,donut.queryPlan.filters);}report('save-rename-duplicate-definitions');
}catch{console.log(JSON.stringify({passed:false,scenario:'live-followup-flow'}));process.exitCode=1;}
finally{for(const id of created){try{await call('/api/app-state',{action:'update_workspace',id,delete:true});}catch{console.log(JSON.stringify({passed:false,scenario:'temporary-definition-cleanup'}));process.exitCode=1;}}}
console.log(JSON.stringify({benchmark:'guided-demo-v1',passed,total:6}));
