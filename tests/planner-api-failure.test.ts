import assert from 'node:assert/strict';
import {test} from 'node:test';
import {POST} from '../app/api/workspaces/generate/route';
test('an unconfigured planner endpoint returns actionable 503 and no unrelated data',async t=>{
 const names=['MORPH_ALLOW_RULE_BASED_PLANNER','MORPH_AI_PLANNER_ENABLED','OPENAI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'];
 const previous=names.map(name=>process.env[name]);
 for(const name of names)delete process.env[name];
 t.after(()=>names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];}));
 const response=await POST(new Request('https://morph.example/api/workspaces/generate',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://morph.example'},body:JSON.stringify({prompt:'Show premium growth on policies as a line chart'})}));
 const body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'ai_planner_not_configured');assert.match(body.error,/configur/i);assert.equal(body.spec,undefined);assert.equal(body.rows,undefined);
});
