import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyPlannerFailure,planWorkspaceRequestWithAi} from '../lib/workspaces/ai-planner';
import {insuranceSemanticCatalog} from '../lib/catalog/semantic';
test('planner diagnostics classify safe failure codes without leaking provider text',()=>{
  assert.equal(classifyPlannerFailure({statusCode:403,message:'secret'}),'authentication');
  assert.equal(classifyPlannerFailure({cause:{statusCode:429}}),'quota');
  assert.equal(classifyPlannerFailure({name:'TimeoutError'}),'timeout');
  assert.equal(classifyPlannerFailure({statusCode:503}),'unavailable');
});
test('live verification refuses to treat deterministic fallback as AI success',async()=>{
  await assert.rejects(planWorkspaceRequestWithAi('Show pending endorsements',insuranceSemanticCatalog,200,{requireAi:true,generateProposal:async()=>{throw {statusCode:429};}}),/quota/);
});
