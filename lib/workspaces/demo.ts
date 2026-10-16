import type {DynamicWorkspaceResponse} from './dynamic';
// Example requests only. The tour uses the normal AI and Gateway pipeline.
export const demoSteps=[
 {title:'Ask for a useful view',description:'Imagine you manage an insurance team. Start by comparing the premium handled by each relationship manager.',prompt:'Show total policy premium by relationship manager. Table only.',action:'Build my example workspace',working:'Building your example table…',takeaway:'A request becomes a workspace, with the data and format you asked for.'},
 {title:'Change the view through chat',description:'Same question, different format. Ask Morph to turn the table into a circular chart.',prompt:'Show the same premium totals as a donut chart only.',action:'Send this in chat',working:'Changing your table into a chart…',takeaway:'You can reshape the workspace without starting again.'},
 {title:'Focus on what matters',description:'Now focus on policies with premium above ₹30,000. Morph should recalculate the chart for that smaller set.',prompt:'Keep the donut chart only, grouped by relationship manager. Only include policies with premium above ₹30,000.',action:'Apply this filter through chat',working:'Applying your premium filter…',takeaway:'Follow-up questions change the underlying query, not just the appearance.'},
] as const;
export function demoStepMatches(step:number,response:DynamicWorkspaceResponse|undefined|null):boolean {
 if(step<0||step>=demoSteps.length||!response)return false;
 const plan=response.queryPlan,blocks=response.spec.blocks;
 if(response.planner?.mode!=='ai'||response.planner.validated!==true||plan.operation!=='select'||plan.entity!=='policies'||plan.groupBy!=='relationship_manager'||plan.analysis?.metricId!=='written_premium'||plan.analysis.time!==null||plan.analysis.comparison!=='none')return false;
 if(blocks.length!==1)return false;
 if(step===0 ? blocks[0].type!=='table' : blocks[0].type!=='chart'||blocks[0].variant!=='donut')return false;
 if(step===0&&response.presentation?.tableLayout!=='grouped_summary')return false;
 return step<2?plan.filters.length===0:plan.filters.length===1&&plan.filters[0].field==='total_premium'&&plan.filters[0].operator==='greater_than'&&plan.filters[0].value===30000;
}
export function advanceDemoStep(step:number,response:DynamicWorkspaceResponse|undefined|null){return demoStepMatches(step,response)?step+1:step;}
