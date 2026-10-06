import { authConfig, resolveMembership, verifyLoginIdentity } from '@/lib/auth/oidc';
import { authDb, hashToken, randomToken, rateLimit } from '@/lib/auth/store';
import { cookie, FLOW_COOKIE, SESSION_COOKIE, secureCookie } from '@/lib/auth/session';

export async function GET(request:Request) {
  try {
    const config = authConfig(), db = await authDb();
    await rateLimit(db,'login-callback',120);
    const url = new URL(request.url), state=url.searchParams.get('state'), code=url.searchParams.get('code'), binding=cookie(request,FLOW_COOKIE);
    if (!state || !/^[a-f0-9]{64}$/.test(state) || !binding || !code || code.length>8192) throw new Error('Invalid callback');
    const now = Math.floor(Date.now()/1000);
    // DELETE RETURNING consumes the transaction atomically before exchanging the code.
    const flow = await db.prepare('DELETE FROM auth_flows WHERE state_hash = ? AND binding_hash = ? AND expires_at > ? RETURNING verifier, nonce').bind(await hashToken(state),await hashToken(binding),now).first<{verifier:string;nonce:string}>();
    if (!flow) throw new Error('Expired or reused sign-in');
    const response = await fetch(config.tokenUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:flow.verifier,redirect_uri:config.redirectUri})});
    if (!response.ok) throw new Error('Token exchange failed');
    const tokens = await response.json() as {id_token?:unknown};
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 32_768) throw new Error('Missing identity');
    const identity = await verifyLoginIdentity(tokens.id_token,flow.nonce,config);
    const membership = resolveMembership(identity.issuer,identity.sub);
    const id = await hashToken(`${identity.issuer}\0${identity.sub}\0${membership.organizationId}`);
    const token = randomToken();
    const oldToken = cookie(request,SESSION_COOKIE);
    await db.batch([
      db.prepare('INSERT INTO organizations (id,slug,name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(membership.organizationId,membership.organizationId,membership.organizationName),
      db.prepare('INSERT INTO app_users (id,organization_id,email,full_name,role) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,full_name=excluded.full_name,role=excluded.role').bind(id,membership.organizationId,identity.email,identity.name,membership.role),
      db.prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR token_hash = ?').bind(now,oldToken ? await hashToken(oldToken):''),
      db.prepare('INSERT INTO auth_sessions (token_hash,user_id,issuer,subject,organization_id,expires_at) VALUES (?,?,?,?,?,?)').bind(await hashToken(token),id,identity.issuer,identity.sub,membership.organizationId,now+8*3600),
    ]);
    const headers = new Headers({Location:config.origin,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    headers.append('Set-Cookie',secureCookie(SESSION_COOKIE,token,8*3600));
    headers.append('Set-Cookie',secureCookie(FLOW_COOKIE,'',0));
    return new Response(null,{status:303,headers});
  } catch {
    // No provider errors/tokens/codes are logged or returned.
    return Response.json({error:'Sign-in could not be verified. Start sign-in again or ask your administrator to check your membership.'},{status:401,headers:{'Cache-Control':'no-store','Set-Cookie':secureCookie(FLOW_COOKIE,'',0)}});
  }
}
