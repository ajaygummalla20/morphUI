'use client';
import {useEffect,useState} from 'react';
import {stageLabels} from '@/lib/workspaces/ag-ui';
import {LoaderCircle} from 'lucide-react';
export function GenerationProgress({stage="planning"}:{stage?:string}){
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{const started=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[]);
  return <div className="build-sequence" aria-busy="true">
    <div className="build-status" role="status" aria-live="polite"><LoaderCircle className="spin" size={24}/><div><span>Morph is working</span><strong>{stageLabels[stage]??"Working on your request"}</strong></div></div>
    <p aria-hidden="true">Elapsed: {seconds}s</p>
    <p>{seconds>=15?'This is taking longer. A stalled AI call can be retried once within the request deadline.':'Results appear only after the query plan and Gateway response are validated.'}</p>
    <p>You can cancel while waiting. A database query already in progress may still finish.</p>
  </div>;
}
