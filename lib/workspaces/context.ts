import {z} from 'zod';
import {gatewayQueryPlanSchema} from '../gateway/contract';
import {validateAnalysis} from '../gateway/analysis';
import type {SemanticCatalog} from '../catalog/semantic';
import type {DynamicWorkspaceResponse} from './dynamic';

// Definitions only: no result rows, identity claims or authorization decisions.
export const workspaceContextSchema=z.object({
  plan:gatewayQueryPlanSchema,
  presentation:z.object({mode:z.enum(['auto','chart_only','dashboard','metrics_only','table_only']),blocks:z.array(z.enum(['metrics','filters','chart','table'])).min(1).max(4),tableLayout:z.enum(['records','grouped_summary'])}).strict(),
  visualization:z.enum(['bar','donut','line','table']).default('table'),
  chartValue:z.enum(['value','change_amount','change_percent']).default('value'),
}).strict();
export type WorkspaceContext=z.infer<typeof workspaceContextSchema>;
export function contextFromResponse(response:DynamicWorkspaceResponse):WorkspaceContext {
  const chart=response.spec.blocks.find(block=>block.type==='chart');
  return workspaceContextSchema.parse({plan:response.queryPlan,presentation:response.presentation,visualization:chart?.type==='chart'?chart.variant:'table',chartValue:chart?.type==='chart'&&chart.valueFormat==='percentage'?'change_percent':response.chartValue??'value'});
}
export function validateWorkspaceContext(input:WorkspaceContext,catalog:SemanticCatalog):WorkspaceContext {
  const context=workspaceContextSchema.parse(input),plan=context.plan;
  const entity=catalog.entities.find(entity=>entity.entity===plan.entity);
  if(!entity || entity.source!==plan.source || catalog.catalogVersion!==plan.catalogVersion)throw new Error('The workspace definition must match the current approved catalogue.');
  const fields=new Map(entity.fields.map(field=>[field.name,field]));
  if(plan.fields.some(field=>!fields.has(field))||plan.filters.some(filter=>!fields.get(filter.field)?.filterOperators.includes(filter.operator))||plan.orderBy.some(sort=>!fields.get(sort.field)?.sortable)||plan.groupBy&&!fields.get(plan.groupBy)?.groupable)throw new Error('The workspace context contains unavailable fields.');
  if(plan.analysis)validateAnalysis(plan,entity);
  return context;
}
export function assertPreservedFilters(context:WorkspaceContext,entity:string,filters:WorkspaceContext['plan']['filters'],changedFields:string[]=[]){
  if(context.plan.entity!==entity)throw new Error('A follow-up must use the current dataset. Start a new workspace to change datasets.');
  const equal=(a:WorkspaceContext['plan']['filters'][number],b:WorkspaceContext['plan']['filters'][number])=>a.field===b.field&&a.operator===b.operator&&a.value===b.value;
  for(const filter of [...context.plan.filters,...filters]){
    if(changedFields.includes(filter.field))continue;
    const before=context.plan.filters.filter(item=>equal(item,filter)).length;
    const after=filters.filter(item=>equal(item,filter)).length;
    if(before!==after)throw new Error('Preserve every existing filter exactly unless the user explicitly changed that field; declare changedFilterFields for intentional changes.');
  }
}
