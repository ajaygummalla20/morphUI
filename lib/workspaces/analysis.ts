import type { SemanticEntity } from '../catalog/semantic';
import { gatewayAggregateRowSchema } from '../gateway/contract';
import { timeBucket, validateAnalysis } from '../gateway/analysis';
import { UnsupportedWorkspaceRequestError, createWorkspaceQueryPlan, type DynamicWorkspaceResponse, type WorkspacePlan, type WorkspaceSourceMode, type WorkspaceSpec } from './dynamic';

export function buildAnalysisWorkspace(options: {plan:WorkspacePlan;entity:SemanticEntity;records:Array<Record<string,string|number|null>>;sourceMode:WorkspaceSourceMode;generatedInMs:number}):DynamicWorkspaceResponse {
  const {plan,entity}=options;
  const {analysis,metric}=validateAnalysis(createWorkspaceQueryPlan(plan),entity);
  const original=options.records.map(row=>gatewayAggregateRowSchema.parse(row));
  if(original.length>plan.limit) throw new UnsupportedWorkspaceRequestError('The analysis is incomplete. Reduce the number of result groups.');
  let rows=original;
  const advance=(bucket:string, amount:number)=>{
    const next=new Date(`${bucket}T00:00:00Z`);
    const grain=analysis.time!.grain;
    if(grain==='year') next.setUTCFullYear(next.getUTCFullYear()+amount);
    else if(grain==='month') next.setUTCMonth(next.getUTCMonth()+amount);
    else next.setUTCDate(next.getUTCDate()+amount*(grain==='week'?7:1));
    return next.toISOString().slice(0,10);
  };
  if(analysis.time && rows.length) {
    const byBucket=new Map(rows.map(row=>[JSON.stringify([row.bucket,row.group]),row]));
    const categories=plan.groupBy?[...new Set(rows.map(row=>row.group))]:[null];
    const filled:typeof rows=[];
    for(let cursor=timeBucket(analysis.time.start,analysis.time.grain);cursor<=analysis.time.end;cursor=advance(cursor,1)) {
      for(const group of categories) filled.push(byBucket.get(JSON.stringify([cursor,group]))??{bucket:cursor,group,value:metric.operation==='average'?null:0,record_count:0});
      if(filled.length>plan.limit) throw new UnsupportedWorkspaceRequestError('Choose a coarser date interval or fewer categories for a complete analysis.');
    }
    rows=filled;
  }
  const count=original.reduce((sum,row)=>sum+row.record_count,0);
  const dateField=entity.fields.find(field=>field.name===analysis.time?.field);
  const groupField=entity.fields.find(field=>field.name===plan.groupBy);
  const basis=`All matching authorized records (${count.toLocaleString('en-IN')})${analysis.time?`; ${dateField?.label ?? analysis.time.field}, ${analysis.time.start} to ${analysis.time.end}, ${analysis.time.grain} intervals`:''}.`;
  const format=(value:number|null)=>value===null?'Not available':new Intl.NumberFormat('en-IN',{...(metric.format==='currency'?{style:'currency',currency:'INR'}:{}),maximumFractionDigits:2}).format(value)+(metric.format==='percentage'?'%':'');
  const byPeriodAndGroup=new Map(rows.map(row=>[JSON.stringify([row.bucket,row.group]),row]));
  const tableRows=rows.map(row=>{
    const previous=analysis.time&&row.bucket?byPeriodAndGroup.get(JSON.stringify([advance(row.bucket,-1),row.group])):undefined;
    const comparable=analysis.comparison==='previous_bucket'&&previous?.value!==null&&previous?.value!==undefined&&row.value!==null;
    return {...row,...(analysis.comparison==='previous_bucket'?{change_amount:comparable?row.value!-previous!.value!:null,change_percent:comparable&&previous!.value!==0?((row.value!-previous!.value!)/Math.abs(previous!.value!))*100:null}:{})};
  });
  const blocks:WorkspaceSpec['blocks']=[];
  if(plan.presentation.blocks.includes('metrics')){
    const total=metric.operation==='average'?original.length===1?original[0].value:null:original.some(row=>row.value!==null)?original.reduce((sum,row)=>sum+(row.value??0),0):null;
    const latest=tableRows.at(-1);
    blocks.push({type:'metrics',items:[{label:metric.operation==='average'&&original.length>1?'Overall average unavailable':metric.label,value:format(total),delta:basis,tone:'lime'},...(analysis.comparison==='previous_bucket'&&!plan.groupBy?[{label:'Latest period change',value:latest?.change_percent==null?'Not available':`${latest.change_percent.toFixed(2)}%`,delta:'Compared with the previous complete period; unavailable when the baseline is zero or missing.',tone:'blue' as const}]:[])]});
  }
  if(plan.presentation.blocks.includes('filters')&&plan.filters.length) blocks.push({type:'filters',items:plan.filters.map(filter=>({label:entity.fields.find(field=>field.name===filter.field)?.label??filter.field,value:`${filter.operator}: ${filter.value}`}))});
  if(plan.presentation.blocks.includes('chart')){
    if(plan.visualization==='line'&&(!analysis.time||plan.groupBy))throw new UnsupportedWorkspaceRequestError('Line charts require one chronological series.');
    if(plan.visualization==='donut'&&metric.operation==='average') throw new UnsupportedWorkspaceRequestError('Category averages cannot form additive parts of a whole. Request a bar chart.');
    if(plan.visualization==='donut'&&rows.some(row=>(row.value??0)<0))throw new UnsupportedWorkspaceRequestError('This measure has negative values and cannot form a circular parts-of-whole chart. Request a bar chart.');
    if(plan.chartValue && plan.chartValue!=='value' && analysis.comparison!=='previous_bucket') throw new UnsupportedWorkspaceRequestError('Period changes require a comparison interval.');
    const change = plan.chartValue === 'change_percent' || plan.chartValue === 'change_amount';
    if(change && plan.visualization==='donut') throw new UnsupportedWorkspaceRequestError('Period changes cannot form a parts-of-whole circular chart. Request a line or bar chart.');
    blocks.push({type:'chart',variant:plan.visualization==='table'?'bar':plan.visualization,title:change?`${plan.chartValue==='change_percent'?'Percentage growth':'Change'} in ${metric.label}`:metric.label,subtitle:basis,valueFormat:plan.chartValue==='change_percent'?'percentage':metric.format,items:tableRows.map(row=>({label:[row.bucket,row.group?.replaceAll('_',' ')].filter(Boolean).join(' · ')||metric.label,value:plan.chartValue==='change_percent'?row.change_percent??null:plan.chartValue==='change_amount'?row.change_amount??null:row.value}))});
  }
  if(plan.presentation.blocks.includes('table'))blocks.push({type:'table',title:plan.title,columns:[...(analysis.time?[{key:'bucket',label:'Period',format:'date' as const}]:[]),...(groupField?[{key:'group',label:groupField.label,format:'text' as const}]:[]),{key:'value',label:metric.label,format:metric.format==='currency'?'currency':metric.format==='percentage'?'percentage':'text'},{key:'record_count',label:'Matching records',format:'text'},...(analysis.comparison==='previous_bucket'?[{key:'change_amount',label:'Change',format:metric.format==='currency'?'currency' as const:'text' as const},{key:'change_percent',label:'Growth',format:'percentage' as const}]:[])],rows:tableRows,totalRows:tableRows.length,emptyMessage:'No authorized records match this period and these filters. Try a different period.'});
  return {intent:plan.intent,interpretation:plan.interpretation,sourceMode:options.sourceMode,spec:{title:plan.title,description:`${plan.interpretation} ${basis}`,source:options.sourceMode==='client_gateway'?'Client-hosted Morph Gateway':'Secure demonstration Gateway',generatedIn:`${Math.max(1,Math.round(options.generatedInMs))}ms`,blocks},queryPlan:createWorkspaceQueryPlan(plan),presentation:plan.presentation,safety:{readOnly:true,rawSqlAccepted:false,fieldsAccessed:plan.fields.length,permittedFields:entity.fields.length,sensitiveData:'masked',maximumRows:entity.maximumRows,returnedRows:original.length}};
}
