"use client";
import {useEffect,useRef} from 'react';
import {ClipboardCheck,Play} from 'lucide-react';
import type {WorkspacePlanReview} from '@/lib/workspaces/plan-review';

export function WorkspacePlanReviewCard({review,busy,onRun,onEdit,onDismiss}:{review:WorkspacePlanReview;busy:boolean;onRun:()=>void;onEdit:()=>void;onDismiss:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[review]);
 const {summary,definition}=review;
 return <section className="plan-review-card" aria-label="Plan review" aria-busy={busy}>
  <div className="plan-review-kicker"><ClipboardCheck size={15}/> No result records fetched</div>
  <h4 ref={heading} tabIndex={-1}>Review your plan</h4>
  <p>{definition.interpretation}</p>
  <dl>
   <div><dt>Dataset</dt><dd>{summary.dataset}</dd></div>
   <div><dt>Measure</dt><dd>{summary.measure}</dd></div>
   <div><dt>Group by</dt><dd>{summary.grouping}</dd></div>
   <div><dt>Display</dt><dd>{summary.format}</dd></div>
   {summary.period&&<div><dt>Period</dt><dd>{summary.period}</dd></div>}
   {summary.comparison!=='None'&&<div><dt>Comparison</dt><dd>{summary.comparison}</dd></div>}
  </dl>
  <div className="plan-review-filters"><strong>Filters</strong>{summary.filters.length?<ul>{summary.filters.map((filter,index)=><li key={index}><b>{filter.field}</b> {filter.operator} <span>{filter.value}</span></li>)}</ul>:<p>No filters</p>}</div>
  <details><summary>Selected fields · {summary.fields.length}</summary><p>{summary.fields.join(', ')}</p></details>
  <p className="plan-review-scope">{review.sourceMode==='secure_demo'?'Sample insurance data':'Client Gateway'} · Up to {summary.rowLimit} result rows.{definition.context.plan.analysis?' Calculated across all matching records.':''} Current permissions are checked when you run.</p>
  <div className="plan-review-actions">
   <button className="generate-button" disabled={busy} onClick={onRun}><Play size={13} fill="currentColor"/> Run this plan</button>
   <button className="secondary-button" disabled={busy} onClick={onEdit}>Ask for a change</button>
   <button className="plan-review-dismiss" disabled={busy} onClick={onDismiss}>Discard</button>
  </div>
 </section>;
}
