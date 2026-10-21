import {createAgentInput,consumeWorkspaceStream} from '../lib/workspaces/ag-ui-client';
import {contextFromResponse,type WorkspaceContext} from '../lib/workspaces/context';
import {demoSteps,demoStepMatches} from '../lib/workspaces/demo';
const endpoint=new URL(process.env.MORPH_BENCHMARK_URL??'https://invalid.example');
if(endpoint.protocol!=='https:'||endpoint.hostname==='invalid.example')throw new Error('Set MORPH_BENCHMARK_URL to the hosted HTTPS agent endpoint.');
endpoint.pathname='/api/workspaces/agent';
const threadId=crypto.randomUUID();let context:WorkspaceContext|undefined;
for(let index=0;index<demoSteps.length;index++){
 const started=performance.now(),stages:string[]=[];
 try{
  const input=await createAgentInput(demoSteps[index].prompt,context,undefined,threadId);
  const signal=AbortSignal.timeout(45_000);
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Accept:'text/event-stream',Origin:endpoint.origin,...(process.env.MORPH_BENCHMARK_TOKEN?{'OAI-Sites-Authorization':`Bearer ${process.env.MORPH_BENCHMARK_TOKEN}`}:{})},body:JSON.stringify(input),signal});
  const result=await consumeWorkspaceStream(response,input,stage=>stages.push(stage),signal);
  const passed=demoStepMatches(index,result)&&stages.join(',')==='catalogue,planning,authorization,rendering';
  console.log(JSON.stringify({step:index+1,passed,stages,durationMs:Math.round(performance.now()-started)}));
  if(!passed){process.exitCode=1;break;}
  context=contextFromResponse(result);
 }catch(error){console.log(JSON.stringify({step:index+1,passed:false,stages,code:error instanceof Error&&'code' in error?error.code:'request_failed',durationMs:Math.round(performance.now()-started)}));process.exitCode=1;break;}
}
