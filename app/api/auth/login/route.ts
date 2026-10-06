import { authConfig } from '@/lib/auth/oidc';
import { authDb, hashToken, randomToken, rateLimit } from '@/lib/auth/store';
import { FLOW_COOKIE, secureCookie } from '@/lib/auth/session';
import { securityResponse } from '@/lib/server/security';

export async function GET() {
  try {
    const config = authConfig();
    const db = await authDb();
    await rateLimit(db,'login-global',120);
    const state = randomToken(), binding = randomToken(), verifier = randomToken(), nonce = randomToken();
    const challengeBytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const now = Math.floor(Date.now()/1000);
    await db.batch([
      db.prepare('DELETE FROM auth_flows WHERE expires_at < ?').bind(now),
      db.prepare('INSERT INTO auth_flows (state_hash, binding_hash, verifier, nonce, expires_at) VALUES (?,?,?,?,?)').bind(await hashToken(state),await hashToken(binding),verifier,nonce,now+600),
    ]);
    const url = new URL(config.authorizationUrl);
    for (const [key,value] of Object.entries({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:'openid profile email',state,nonce,code_challenge:challenge,code_challenge_method:'S256'})) url.searchParams.set(key,value);
    return new Response(null,{status:302,headers:{Location:url.toString(),'Set-Cookie':secureCookie(FLOW_COOKIE,binding,600),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch(error) { return securityResponse(error) ?? Response.json({error:'Sign-in is temporarily unavailable.'},{status:503}); }
}
