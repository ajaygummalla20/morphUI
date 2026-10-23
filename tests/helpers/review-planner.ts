import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {AiWorkspaceProposal} from '../../lib/workspaces/ai-planner';

// Only the external model is stubbed; API, catalogue, Gateway and D1 are real.
export function stubReviewPlanner(t:TestContext){
 const variables={MORPH_AI_PLANNER_ENABLED:'true',MORPH_PLANNER_PROVIDER:'google',GOOGLE_GENERATIVE_AI_API_KEY:'test-only-review-key',MORPH_ALLOW_RULE_BASED_PLANNER:'false'};
 const previous=Object.keys(variables).map(name=>process.env[name]);
 Object.assign(process.env,variables);
 t.after(()=>Object.keys(variables).forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];}));
 let calls=0;
 let overrides:Partial<AiWorkspaceProposal>={};
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{
  assert.match(String(url),/^https:\/\/generativelanguage\.googleapis\.com\//);calls++;
  return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({
   supported:true,intent:'endorsements',entity:'endorsements',title:'Pending endorsements by type',interpretation:'Count pending endorsements by type, shown as a summary table.',
   fields:['type'],filters:[{field:'status',operator:'in',value:'requested,documents_pending,under_review'}],
   analysis:{metricId:'endorsement_count',time:null,comparison:'none'},chartValue:null,changedFilterFields:[],
   groupBy:'type',orderBy:[],metricIds:[],visualization:'table',presentation:{blocks:['table'],tableLayout:'grouped_summary'},unsupportedReason:'',...overrides,
  })}]},finishReason:'STOP'}]});
 });
 return {calls:()=>calls,setProposal:(next:Partial<AiWorkspaceProposal>)=>{overrides=next;}};
}
