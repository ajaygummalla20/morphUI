import assert from 'node:assert/strict';
import {test} from 'node:test';
import {plannerBenchmark,scoreBenchmark} from '../lib/workspaces/benchmark';
import {WorkspaceRequestError} from '../lib/workspaces/client-error';
test('benchmark detects wrong dataset, format, filters, calculation and fallback independently',()=>{
 const example=plannerBenchmark.find(c=>c.id==='renewals-table')!;
 const body={presentation:{tableLayout:'grouped_summary'},planner:{mode:'ai',validated:true},queryPlan:{entity:'policies',operation:'select',rowLimit:200,groupBy:'relationship_manager',analysis:{metricId:'policy_count'},filters:example.filters},spec:{blocks:[{type:'table'}]}};
 assert.equal(scoreBenchmark(example,200,body).passed,true);
 for(const bad of [{...body,planner:{mode:'deterministic_fallback',validated:true}},{...body,queryPlan:{...body.queryPlan,entity:'claims'}},{...body,spec:{blocks:[{type:'chart'}]}},{...body,queryPlan:{...body.queryPlan,filters:[]}},{...body,queryPlan:{...body.queryPlan,analysis:{metricId:'written_premium'}}}])assert.equal(scoreBenchmark(example,200,bad).passed,false);
});
test('provider failures and blank refusals are not scored as successful clarification',()=>{
 const example=plannerBenchmark.find(c=>c.id==='ambiguous-growth')!;
 assert.equal(scoreBenchmark(example,503,{error:'timeout'}).passed,false);
 assert.equal(scoreBenchmark(example,422,{code:'unsupported_workspace_request',error:''}).passed,false);
 assert.equal(scoreBenchmark(example,422,{code:'unsupported_workspace_request',error:'Which period should be compared?'}).passed,true);
});
test('clarification errors stay distinct from retryable provider failures',()=>{
 assert.equal(new WorkspaceRequestError('Which period?','unsupported_workspace_request').needsClarification,true);
 assert.equal(new WorkspaceRequestError('Provider timeout','ai_planner_timeout').needsClarification,false);
});
