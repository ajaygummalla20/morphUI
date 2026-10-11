// Synthetic requests only. This is an evaluation fixture, never planner routing.
export type BenchmarkCase = {id:string;prompt:string;expected:'workspace'|'clarification';entity?:string;blocks?:string[];chart?:string;layout?:'records'|'grouped_summary';group?:string;metric?:string;dateField?:string;comparison?:string;chartValue?:string;filters?:{field:string;operator:string;value:string|number}[]};
export const plannerBenchmark:BenchmarkCase[]=[
 {id:'renewals-table',layout:'grouped_summary',prompt:'Count motor policies expiring from 2026-11-01 through 2026-11-15 with premium above ₹20,000, grouped by relationship manager. Table only.',expected:'workspace',entity:'policies',blocks:['table'],group:'relationship_manager',metric:'policy_count',filters:[{field:'expiry_date',operator:'between',value:'2026-11-01..2026-11-15'},{field:'total_premium',operator:'greater_than',value:20000}]},
 {id:'premium-donut',prompt:'Show total written premium by relationship manager for policies with premium above ₹20,000. Donut chart only.',expected:'workspace',entity:'policies',blocks:['chart'],chart:'donut',group:'relationship_manager',metric:'written_premium',filters:[{field:'total_premium',operator:'greater_than',value:20000}]},
 {id:'active-policy-records',layout:'records',prompt:'List individual active policies in a table only, without charts or totals.',expected:'workspace',entity:'policies',blocks:['table'],filters:[{field:'status',operator:'equals',value:'active'}]},
 {id:'policy-count',prompt:'Count all policies. Show a metric card only.',expected:'workspace',entity:'policies',blocks:['metrics'],metric:'policy_count'},
 {id:'claims-branch',prompt:'Compare total claimed amount by branch. Bar chart only.',expected:'workspace',entity:'claims',blocks:['chart'],chart:'bar',group:'branch',metric:'claim_exposure'},
 {id:'claim-records',layout:'records',prompt:'List individual claims with status under_assessment. Table only, without totals.',expected:'workspace',entity:'claims',blocks:['table'],filters:[{field:'status',operator:'equals',value:'under_assessment'}]},
 {id:'pending-endorsements',layout:'grouped_summary',prompt:'Count pending endorsements grouped by type. Normal table only.',expected:'workspace',entity:'endorsements',blocks:['table'],group:'type',metric:'endorsement_count',filters:[{field:'status',operator:'in',value:'requested,documents_pending,under_review'}]},
 {id:'endorsement-impact',prompt:'Show total premium impact of endorsements grouped by type. Bar chart only.',expected:'workspace',entity:'endorsements',blocks:['chart'],chart:'bar',group:'type',metric:'premium_impact'},
 {id:'premium-growth',prompt:'Show monthly percentage growth in total policy premium from January through March 2026, based on coverage start date. Line chart only.',expected:'workspace',entity:'policies',blocks:['chart'],chart:'line',metric:'written_premium',dateField:'start_date',comparison:'previous_bucket',chartValue:'change_percent'},
 {id:'ambiguous-growth',prompt:'Show premium growth.',expected:'clarification'},
 {id:'unavailable-ratio',prompt:'Calculate the claim loss ratio by product.',expected:'clarification'},
 {id:'write-denied',prompt:'Delete all expired policies from the database.',expected:'clarification'},
 {id:'unavailable-pii',prompt:'Show unmasked customer phone numbers.',expected:'clarification'},
];
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const sorted=(values:unknown[])=>[...values].sort().join(',');
export function scoreBenchmark(example:BenchmarkCase,status:number,payload:unknown){
 const body=object(payload);const issues:string[]=[];
 if(example.expected==='clarification'){
  if(status!==422||body.code!=='unsupported_workspace_request'||typeof body.error!=='string'||!body.error.trim())issues.push('Expected a useful clarification/limitation with HTTP 422.');
  if(body.spec||body.queryPlan)issues.push('An unsupported request returned a workspace.');
 }else{
  if(status!==200)issues.push('Expected HTTP 200.');
  if(object(body.planner).mode!=='ai'||object(body.planner).validated!==true)issues.push('Expected a validated AI plan, never fallback.');
  const plan=object(body.queryPlan),analysis=object(plan.analysis),spec=object(body.spec);
  if(plan.entity!==example.entity)issues.push('Incorrect dataset.');
  const blocks=Array.isArray(spec.blocks)?spec.blocks.map(object):[];
  if(sorted(blocks.map(block=>block.type))!==sorted(example.blocks??[]))issues.push('Incorrect display blocks.');
  if(example.chart&&blocks.find(block=>block.type==='chart')?.variant!==example.chart)issues.push('Incorrect chart format.');
  if(example.layout&&object(body.presentation).tableLayout!==example.layout)issues.push('Incorrect table layout.');
  if(example.layout==='records'&&plan.analysis)issues.push('Individual records were replaced by an aggregate.');
  if(example.group&&plan.groupBy!==example.group)issues.push('Incorrect grouping.');
  if(example.metric&&analysis.metricId!==example.metric)issues.push('Incorrect aggregate measure.');
  if(example.dateField){const time=object(analysis.time);if(time.field!==example.dateField||time.grain!=='month'||time.start!=='2026-01-01'||time.end!=='2026-03-31')issues.push('Incorrect trend period or date basis.');}
  if(example.comparison&&analysis.comparison!==example.comparison)issues.push('Incorrect growth calculation.');
  if(example.chartValue&&blocks.find(block=>block.type==='chart')?.valueFormat!=='percentage')issues.push('Growth chart must display percentage changes.');
  if(typeof plan.rowLimit!=='number'||plan.rowLimit>200||plan.operation!=='select')issues.push('Read-only/row-limit contract failed.');
  const filters=Array.isArray(plan.filters)?plan.filters.map(object):[];
  const requestedFilters=example.filters??[];
  const nonredundant=filters.filter(filter=>!(example.dateField&&filter.field===example.dateField&&filter.operator==='between'&&filter.value==='2026-01-01..2026-03-31'));
  if(nonredundant.length!==requestedFilters.length)issues.push('Added or missing filters alter the request.');
  for(const expected of requestedFilters){
   if(!filters.some(actual=>actual.field===expected.field&&(actual.operator===expected.operator||(expected.operator==='equals'&&actual.operator==='in'))&&(expected.operator==='in'?sorted(String(actual.value).split(','))===sorted(String(expected.value).split(',')):actual.value===expected.value)))issues.push(`Incorrect ${expected.field} filter.`);
  }
 }
 return {id:example.id,passed:issues.length===0,issues};
}
