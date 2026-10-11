'use client';
import {useState} from 'react';
import type {DynamicWorkspaceResponse} from '@/lib/workspaces/dynamic';
export function WorkspaceConversation({response,onFollowup,busy}:{response:DynamicWorkspaceResponse;onFollowup:(prompt:string)=>void;busy:boolean}){
 const [text,setText]=useState('');const plan=response.queryPlan;
 return <section className="workspace-conversation" aria-label="Refine this workspace"><div><h3>Refine this workspace</h3><p>Keep the current dataset and filters. Ask for a different format, measure or grouping, or explicitly change a filter.</p></div>
 <form onSubmit={event=>{event.preventDefault();if(text.trim().length>=8)onFollowup(text.trim());}}><label htmlFor="followup-request" className="sr-only">Follow-up request</label><input id="followup-request" value={text} maxLength={500} minLength={8} required disabled={busy} onChange={event=>setText(event.target.value)} placeholder="Make this a donut chart only…"/><button className="primary-button" disabled={busy||text.trim().length<8}>Apply change</button></form>
 <div className="demo-personas"><button disabled={busy} onClick={()=>onFollowup('Show the same result in a normal table only.')}>Table only</button>{plan.groupBy&&!plan.analysis?.time&&<button disabled={busy} onClick={()=>onFollowup('Show the same measure and filters as a donut chart only.')}>Donut chart</button>}<button disabled={busy} onClick={()=>onFollowup('Refresh this workspace without changing its query or display.')}>Refresh data</button></div>
 </section>;
}
export function RequestInterpretation({response}:{response:DynamicWorkspaceResponse}){
 const plan=response.queryPlan;
 return <details className="request-interpretation"><summary>How Morph understood this request</summary><dl><div><dt>Dataset</dt><dd>{plan.entity}</dd></div><div><dt>Calculation</dt><dd>{plan.analysis?.metricId.replaceAll('_',' ')??'Individual records'}</dd></div><div><dt>Grouping</dt><dd>{plan.groupBy?.replaceAll('_',' ')??(plan.analysis?.time?`${plan.analysis.time.grain} by ${plan.analysis.time.field.replaceAll('_',' ')}`:'None')}</dd></div><div><dt>Format</dt><dd>{response.spec.blocks.map(block=>block.type==='chart'?`${block.variant} chart`:block.type).join(', ')}</dd></div></dl><p><strong>Query filters:</strong> {plan.filters.length?plan.filters.map(filter=>`${filter.field.replaceAll('_',' ')} ${filter.operator.replaceAll('_',' ')} ${filter.value}`).join('; '):'None'}</p>{plan.analysis?.time&&<p><strong>Period:</strong> {plan.analysis.time.start} to {plan.analysis.time.end}</p>}<p>{response.sourceMode==='secure_demo'?'Synthetic demonstration data · secure demo Gateway':'Live client Gateway · current permissions enforced'}</p></details>;
}
