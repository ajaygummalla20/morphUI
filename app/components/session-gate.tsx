'use client';
import { useEffect, useState, type ReactNode } from 'react';

const EXPIRED = 'morph-session-expired';
export async function authenticatedFetch(input:RequestInfo|URL,init?:RequestInit) {
  const response = await fetch(input,init);
  if (response.status === 401) window.dispatchEvent(new Event(EXPIRED));
  return response;
}
export function clearLegacyCache() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('morph')) localStorage.removeItem(key);
  } catch { /* Storage is optional. */ }
}
export function SessionGate({children}:{children:ReactNode}) {
  const [status,setStatus] = useState<'loading'|'ready'|'signed_out'|'error'>('loading');
  const [message,setMessage] = useState('');
  const [demo,setDemo] = useState(false);
  useEffect(()=>{
    let cancelled=false;
    clearLegacyCache();
    const expire=()=>{clearLegacyCache();setStatus('signed_out');setMessage('Your session expired. Sign in again to continue.');};
    window.addEventListener(EXPIRED,expire);
    fetch('/api/auth/session',{cache:'no-store'}).then(async response=>{
      const result=await response.json() as {mode?:string;error?:string};
      if (cancelled) return;
      if (response.ok) {setDemo(result.mode==='demo');setStatus('ready');}
      else {setMessage(result.error??'Sign-in is unavailable.');setStatus(response.status===401?'signed_out':'error');}
    }).catch(()=>{if(!cancelled){setStatus('error');setMessage('Cannot reach MorphUI. Please retry.');}});
    return ()=>{cancelled=true;window.removeEventListener(EXPIRED,expire);};
  },[]);
  const logout=async()=>{
    try {
      const response=await fetch('/api/auth/logout',{method:'POST'});
      if (!response.ok) throw new Error();
      clearLegacyCache();setStatus('signed_out');setMessage('You are signed out of MorphUI.');
    } catch {setMessage('Sign-out failed. Please retry.');}
  };
  if(status==='ready') return <><div className="session-bar"><span>{demo?'Demonstration · synthetic data':'Organization session'}</span>{message&&<span role="alert">{message}</span>}<button onClick={()=>void logout()}>Sign out</button></div>{children}</>;
  return <main className="auth-page"><section className="auth-card"><span className="page-kicker">MorphUI</span><h1>Your data. Your workspace.</h1><p role="status">{status==='loading'?'Checking your session…':message}</p>{status==='signed_out'&&<a className="primary-button" href="/api/auth/login">Sign in with your organization</a>}{status==='error'&&<button className="primary-button" onClick={()=>window.location.reload()}>Retry connection</button>}</section></main>;
}
