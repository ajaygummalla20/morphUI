import assert from 'node:assert/strict';
import {planWorkspaceRequestWithAi} from '../lib/workspaces/ai-planner';
import {insuranceSemanticCatalog} from '../lib/catalog/semantic';

// Synthetic prompts/catalogue only. Uses a server environment secret; never prints it.
const cases=[
  {prompt:'Show monthly premium growth on policies from January through March 2026 by coverage start date as a line chart and summary table.',entity:'policies',blocks:['chart','table'],visualization:'line',group:undefined},
  {prompt:'Show pending endorsements grouped by type. Show in a normal table only.',entity:'endorsements',blocks:['table'],visualization:'table',group:'type'},
  {prompt:'Show motor policies expiring in the next 15 days with premium above ₹20,000, grouped by relationship manager. Show summed premium per relationship manager in a circular graph and summary table.',entity:'policies',blocks:['chart','table'],visualization:'donut',group:'relationship_manager'},
  {prompt:'Compare claims by branch as a bar chart only.',entity:'claims',blocks:['chart'],visualization:'bar',group:'branch'},
];
for(const example of cases) {
  const started=performance.now();
  const {plan,planner}=await planWorkspaceRequestWithAi(example.prompt,insuranceSemanticCatalog,200,{requireAi:true});
  assert.equal(planner.mode,'ai');assert.equal(plan.entity,example.entity);assert.equal(plan.visualization,example.visualization);assert.equal(plan.groupBy,example.group);
  assert.deepEqual([...plan.presentation.blocks].sort(),[...example.blocks].sort());
  if(example.entity==='endorsements') assert.ok(plan.filters.some(f=>f.field==='status'&&!String(f.value).includes('approved')));
  if(example.entity==='policies'&&example.group) {assert.ok(plan.filters.some(f=>f.field==='total_premium'&&f.operator==='greater_than'&&f.value===20000));assert.equal(plan.days,15);}
  if(example.visualization==='line'){assert.equal(plan.analysis?.metricId,'written_premium');assert.equal(plan.analysis?.time?.grain,'month');assert.equal(plan.analysis?.time?.start,'2026-01-01');assert.equal(plan.analysis?.time?.end,'2026-03-31');assert.equal(plan.analysis?.comparison,'previous_bucket');}
  console.log(JSON.stringify({case:example.entity,mode:planner.mode,passed:true,durationMs:Math.round(performance.now()-started)}));
}
