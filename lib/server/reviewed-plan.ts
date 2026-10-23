import type {SemanticCatalog} from '@/lib/catalog/semantic';
import {validateWorkspaceContext,workspaceContextSchema,workspaceReviewedDefinitionSchema,type WorkspaceReviewedDefinition} from '@/lib/workspaces/context';
import {createWorkspaceQueryPlan,type WorkspacePlan,type WorkspaceSourceMode} from '@/lib/workspaces/dynamic';
import {validateProposal} from '@/lib/workspaces/ai-planner';
import {workspacePlanReviewSchema,type WorkspacePlanReview} from '@/lib/workspaces/plan-review';

export function createPlanReview(plan:WorkspacePlan,catalog:SemanticCatalog,sourceMode:WorkspaceSourceMode):WorkspacePlanReview {
  const entity=catalog.entities.find(entity=>entity.entity===plan.entity)!;
  const fieldLabel=(name:string)=>entity.fields.find(field=>field.name===name)?.label??name;
  return workspacePlanReviewSchema.parse({
    type:'plan_review',sourceMode,
    definition:{intent:plan.intent,title:plan.title,interpretation:plan.interpretation,metricIds:plan.metrics.filter(metric=>!plan.analysis||metric.id===plan.analysis.metricId).map(metric=>metric.id),context:{
      plan:createWorkspaceQueryPlan(plan),presentation:plan.presentation,visualization:plan.visualization,chartValue:plan.chartValue??'value',
    }},
    summary:{
      dataset:entity.label,
      measure:plan.analysis?entity.metrics.find(metric=>metric.id===plan.analysis!.metricId)!.label:'Individual records',
      grouping:[plan.groupBy?fieldLabel(plan.groupBy):null,plan.analysis?.time?`${plan.analysis.time.grain} by ${fieldLabel(plan.analysis.time.field)}`:null].filter(Boolean).join(' · ')||'None',
      format:plan.presentation.blocks.map(block=>block==='chart'?`${plan.visualization} chart`:block==='table'?(plan.presentation.tableLayout==='grouped_summary'?'Summary table':'Records table'):block==='metrics'?'Metric cards':'Filter summary').join(', '),
      fields:plan.fields.map(fieldLabel),
      filters:plan.filters.map(filter=>({field:fieldLabel(filter.field),operator:filter.operator.replaceAll('_',' '),value:filter.value})),
      period:plan.analysis?.time?`${plan.analysis.time.start} to ${plan.analysis.time.end}`:null,
      comparison:plan.analysis?.comparison==='previous_bucket'?'Change from the previous period':'None',
      rowLimit:plan.limit,
    },
  });
}

export function validateReviewedPlan(input:WorkspaceReviewedDefinition,catalog:SemanticCatalog):WorkspacePlan {
  const definition=workspaceReviewedDefinitionSchema.parse(input);
  const context=validateWorkspaceContext(definition.context,catalog);
  const query=context.plan;
  const plan=validateProposal({
    supported:true,intent:definition.intent,title:definition.title,interpretation:definition.interpretation,
    entity:query.entity,fields:query.fields,filters:query.filters,groupBy:query.groupBy??null,orderBy:query.orderBy,
    metricIds:definition.metricIds,analysis:query.analysis??null,chartValue:context.chartValue,
    visualization:context.visualization,presentation:{blocks:context.presentation.blocks,tableLayout:context.presentation.tableLayout},unsupportedReason:'',
  },catalog,query.rowLimit);
  const reconstructed=workspaceContextSchema.parse({plan:createWorkspaceQueryPlan(plan),presentation:plan.presentation,visualization:plan.visualization,chartValue:plan.chartValue});
  // Never silently add fields, clamp a limit, or change a reviewed display.
  if(JSON.stringify(reconstructed)!==JSON.stringify(context))throw new Error('The reviewed definition no longer matches the approved plan.');
  return plan;
}
