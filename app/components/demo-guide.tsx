'use client';
import {useState} from 'react';
export const demoScenes=[
 {persona:'Operations',title:'Renewal priorities',description:'Focus on upcoming motor renewals and who owns them.',prompt:'Count motor policies expiring in the next 15 days with premium above ₹20,000, grouped by relationship manager. Table only.',followup:'Show total premium for these policies by relationship manager as a donut chart only.'},
 {persona:'Claims analyst',title:'Claims exposure',description:'Compare claim amounts, then explore a branch.',prompt:'Show total claimed amount by branch. Bar chart only.',followup:'Show the same result as a normal table only.'},
 {persona:'Executive',title:'Premium performance',description:'See a monthly trend with an explicit calculation basis.',prompt:'Show monthly percentage growth in total policy premium from January through March 2026, based on coverage start date. Line chart only.',followup:'Show the same monthly growth in a table only.'},
 {persona:'Trust',title:'Clarification and boundaries',description:'Ask an ambiguous question, then try a prohibited operation.',prompt:'Show premium growth.',followup:null},
] as const;
export function DemoGuide({onSelect,busy}:{onSelect:(prompt:string)=>void;busy:boolean}){
 const [step,setStep]=useState(0);const scene=demoScenes[step];
 return <section className="demo-guide" aria-label="Guided product demonstration">
  <div className="demo-guide-heading"><div><span className="intro-kicker">One data source. Different workspaces.</span><h2>Walk through Morph</h2><p>Example personas describe jobs; they do not change your identity or permissions.</p></div><span className="source-tag">Guided walkthrough · {step+1} / {demoScenes.length}</span></div>
  <div className="demo-personas">{demoScenes.map((item,index)=><button key={item.persona} aria-pressed={step===index} onClick={()=>setStep(index)}>{item.persona}</button>)}</div>
  <div className="demo-scene"><div><h3>{scene.title}</h3><p>{scene.description}</p><blockquote>{scene.prompt}</blockquote>{scene.followup&&<p><strong>Then refine:</strong> “{scene.followup}”</p>}</div><button className="secondary-button" disabled={busy} onClick={()=>onSelect(scene.prompt)}>Use this request</button></div>
  {scene.persona==='Trust'&&<button className="secondary-button" disabled={busy} onClick={()=>onSelect('Delete all expired policies from the database.')}>Try a prohibited request</button>}
 </section>;
}
