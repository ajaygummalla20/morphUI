"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,LoaderCircle,MessageSquare,Sparkles} from 'lucide-react';
import type {DynamicWorkspaceResponse} from '@/lib/workspaces/dynamic';
import type {ConversationMessage} from '@/lib/workspaces/conversation';

export function WorkspaceConversation({response,messages,onFollowup,busy,onCancel,onRetry,error,needsClarification}:{response:DynamicWorkspaceResponse|null;messages:ConversationMessage[];onFollowup:(prompt:string,reply?:boolean)=>void;busy:boolean;onCancel:()=>void;onRetry:()=>void;error:string|null;needsClarification:boolean}){
 const [text,setText]=useState('');
 const history=useRef<HTMLDivElement>(null);
 const followBottom=useRef(true);
 const plan=response?.queryPlan;
 const composer=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(needsClarification&&!busy)composer.current?.focus();},[needsClarification,busy]);
 useEffect(()=>{if(followBottom.current&&history.current)history.current.scrollTop=history.current.scrollHeight;},[messages,busy]);
 const send=(value:string,reply=true)=>{if(busy||value.trim().length<1)return;followBottom.current=true;onFollowup(value.trim(),reply);setText('');};
 return <aside className="workspace-chat" aria-label="Workspace conversation">
  <header className="chat-heading"><span className="chat-mark"><MessageSquare size={17}/></span><div><h3>{response ? "Chat with your workspace" : "Let’s clarify your request"}</h3><p>{response ? "Shape this view, one request at a time." : "Answer a question so Morph can build the right view."}</p></div></header>
  <div className="chat-history" ref={history} role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions" onScroll={()=>{const node=history.current;if(node)followBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;}}>
   {messages.map(message=><article key={message.id} className={`chat-message ${message.role} ${message.kind??''}`}><span className="chat-author">{message.role==='user'?'You':'Morph'}</span><p>{message.content}</p></article>)}
   {busy&&<div className="chat-working" role="status"><LoaderCircle size={15} className="spin"/> {response ? "Updating your workspace…" : "Working on your request…"}<button onClick={onCancel}>Cancel</button></div>}
  </div>
  <div className="chat-composer">
   {error&&<p className="chat-preserved">{response ? "Your last successful workspace is still visible. " : "Your original request is retained. "}{needsClarification?'Reply below to clarify.':<button onClick={onRetry}>Retry last request</button>}</p>}
   {response && <div className="chat-quick-actions"><button disabled={busy} onClick={()=>send('Show the same result in a normal table only.',false)}>Table only</button>{plan?.groupBy&&!plan.analysis?.time&&<button disabled={busy} onClick={()=>send('Show the same measure and filters as a donut chart only.',false)}>Donut chart</button>}<button disabled={busy} onClick={()=>send('Refresh this workspace without changing its query or display.',false)}>Refresh</button></div>}
   <form onSubmit={event=>{event.preventDefault();send(text);}}><label htmlFor="followup-request" className="sr-only">Message your workspace</label><textarea ref={composer} id="followup-request" value={text} maxLength={500} minLength={1} required rows={3} disabled={busy} onChange={event=>setText(event.target.value)} placeholder={response ? "Make this a circular chart, change a filter, or show individual records…" : "Answer Morph’s question…"}/><div className="chat-send-row"><span><Sparkles size={12}/> {response ? "Current filters stay unless you change them" : "Your original request stays in context"}</span><button aria-label="Send message" className="chat-send" disabled={busy||text.trim().length<1}><ArrowUp size={17}/></button></div></form>
   <p className="chat-data-note">{!response?'No workspace generated yet':response.sourceMode==='secure_demo'?'Synthetic demo data':'Client Gateway'} · Read only · Results stay out of the AI prompt</p>
  </div>
 </aside>;
}
export function RequestInterpretation({response}:{response:DynamicWorkspaceResponse}){
 const plan=response.queryPlan;
 return <details className="request-interpretation"><summary>How Morph understood this request</summary><dl><div><dt>Dataset</dt><dd>{plan.entity}</dd></div><div><dt>Calculation</dt><dd>{plan.analysis?.metricId.replaceAll('_',' ')??'Individual records'}</dd></div><div><dt>Grouping</dt><dd>{plan.groupBy?.replaceAll('_',' ')??(plan.analysis?.time?`${plan.analysis.time.grain} by ${plan.analysis.time.field.replaceAll('_',' ')}`:'None')}</dd></div><div><dt>Format</dt><dd>{response.spec.blocks.map(block=>block.type==='chart'?`${block.variant} chart`:block.type).join(', ')}</dd></div></dl><p><strong>Query filters:</strong> {plan.filters.length?plan.filters.map(filter=>`${filter.field.replaceAll('_',' ')} ${filter.operator.replaceAll('_',' ')} ${filter.value}`).join('; '):'None'}</p>{plan.analysis?.time&&<p><strong>Period:</strong> {plan.analysis.time.start} to {plan.analysis.time.end}</p>}<p>{response.sourceMode==='secure_demo'?'Synthetic demonstration data · secure demo Gateway':'Live client Gateway · current permissions enforced'}</p></details>;
}
