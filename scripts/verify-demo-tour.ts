import {demoSteps,demoStepMatches} from '../lib/workspaces/demo';
import {contextFromResponse} from '../lib/workspaces/context';
import type {DynamicWorkspaceResponse} from '../lib/workspaces/dynamic';
const endpoint=new URL(process.env.MORPH_BENCHMARK_URL??'');
if(endpoint.protocol!=='https:')throw new Error('Use an HTTPS generation endpoint.');
const headers:Record<string,string>={'Content-Type':'application/json',Origin:endpoint.origin};
if(process.env.MORPH_BENCHMARK_TOKEN)headers['OAI-Sites-Authorization']=`Bearer ${process.env.MORPH_BENCHMARK_TOKEN}`;
let previous:DynamicWorkspaceResponse|undefined,passed=0;
for(let step=0;step<demoSteps.length;step++){
 const started=performance.now();let status=0,ok=false;
 try{
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers,body:JSON.stringify({prompt:demoSteps[step].prompt,limit:200,...(previous?{context:contextFromResponse(previous)}:{})}),signal:AbortSignal.timeout(45_000)});
  status=response.status;
  if(response.ok){const body=await response.json() as DynamicWorkspaceResponse;ok=demoStepMatches(step,body);if(ok)previous=body;}
 }catch{/* Only safe IDs, status and timings are reported; never rows or credentials. */}
 console.log(JSON.stringify({step:step+1,passed:ok,status,durationMs:Math.round(performance.now()-started)}));
 if(!ok){process.exitCode=1;break;}passed++;
}
console.log(JSON.stringify({benchmark:'product-tour-v1',passed,total:demoSteps.length}));
