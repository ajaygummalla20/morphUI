'use client';
import { useState } from 'react';
import type { SavedWorkspaceRecord } from '@/lib/app-state/types';
import { authenticatedFetch } from './session-gate';

export function SavedWorkspaces({items,onOpen,onRefresh}:{items:SavedWorkspaceRecord[];onOpen:(item:SavedWorkspaceRecord)=>void;onRefresh:()=>Promise<void>}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null);
  const update=async(id:string,changes:Record<string,unknown>)=>{
    setBusy(id);setError('');
    try {
      const response=await authenticatedFetch('/api/app-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_workspace',id,...changes})});
      if(!response.ok) throw new Error(((await response.json()) as {error?:string}).error??'Could not update workspace.');
      await onRefresh();
    } catch(e){setError(e instanceof Error?e.message:'Could not update workspace.');} finally {setBusy(null);}
  };
  if(!items.length) return null;
  return <details className="saved-workspaces"><summary>Saved workspaces ({items.length})</summary><p>Shared definitions stay within your organization. Opening one fetches data using your current permissions.</p>{error&&<p role="alert">{error}</p>}<ul>{[...items].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(item=><li key={item.id}><button className="saved-open" onClick={()=>onOpen(item)}>{item.pinned?'★ ':''}{item.title}{item.shared?' · Shared':''}</button>{item.canEdit!==false&&<form onSubmit={e=>{e.preventDefault();const title=String(new FormData(e.currentTarget).get('title')??'').trim();if(title)void update(item.id,{title});}}><input aria-label={`Rename ${item.title}`} name="title" defaultValue={item.title} maxLength={160} required/><button disabled={busy===item.id}>Rename</button><button type="button" disabled={busy===item.id} onClick={()=>void update(item.id,{pinned:!item.pinned})}>{item.pinned?'Unpin':'Pin'}</button><button type="button" disabled={busy===item.id} onClick={()=>void update(item.id,{shared:!item.shared})}>{item.shared?'Stop sharing':'Share with organization'}</button><button type="button" disabled={busy===item.id} onClick={()=>void update(item.id,{delete:true})}>Delete</button></form>}</li>)}</ul></details>;
}
