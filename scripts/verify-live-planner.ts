import {planWorkspaceRequestWithAi} from '../lib/workspaces/ai-planner';
import {insuranceSemanticCatalog} from '../lib/catalog/semantic';
import {createWorkspaceQueryPlan,buildCatalogDrivenWorkspace,UnsupportedWorkspaceRequestError} from '../lib/workspaces/dynamic';
import {plannerBenchmark,scoreBenchmark} from '../lib/workspaces/benchmark';
// Outputs only case IDs, scores and latency. Never prints secrets or result rows.
const results=[];
for(const example of plannerBenchmark){
 const started=performance.now();let status=0;let payload:unknown={};
 try{
  if(process.env.MORPH_BENCHMARK_URL){
   const endpoint=new URL(process.env.MORPH_BENCHMARK_URL);
   if(process.env.MORPH_BENCHMARK_TOKEN && endpoint.protocol !== 'https:')throw new Error('Credentials require HTTPS.');
   const headers:Record<string,string>={'Content-Type':'application/json',Origin:new URL(process.env.MORPH_BENCHMARK_URL).origin};
   if(process.env.MORPH_BENCHMARK_TOKEN)headers['OAI-Sites-Authorization']=`Bearer ${process.env.MORPH_BENCHMARK_TOKEN}`;
   const response=await fetch(process.env.MORPH_BENCHMARK_URL,{method:'POST',redirect:'error',headers,body:JSON.stringify({prompt:example.prompt,limit:200}),signal:AbortSignal.timeout(45_000)});
   status=response.status;payload=await response.json();
  }else{
   const {plan,planner}=await planWorkspaceRequestWithAi(example.prompt,insuranceSemanticCatalog,200,{requireAi:true});
   const entity=insuranceSemanticCatalog.entities.find(entity=>entity.entity===plan.entity)!;
   payload={...buildCatalogDrivenWorkspace({plan,entity,records:[],sourceMode:'secure_demo',generatedInMs:performance.now()-started}),queryPlan:createWorkspaceQueryPlan(plan),planner};status=200;
  }
 }catch(error){if(error instanceof UnsupportedWorkspaceRequestError){status=422;payload={code:'unsupported_workspace_request',error:error.message};}}
 const result={...scoreBenchmark(example,status,payload),status,durationMs:Math.round(performance.now()-started)};
 results.push(result);console.log(JSON.stringify(result));
}
console.log(JSON.stringify({benchmark:'insurance-core-v1',passed:results.filter(r=>r.passed).length,total:results.length,mode:process.env.MORPH_BENCHMARK_URL?'deployed-api':'planner-only',results}));
if(results.some(result=>!result.passed))process.exitCode=1;
