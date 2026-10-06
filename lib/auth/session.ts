import { resolveMembership, authConfig } from './oidc';
import { authDb, hashToken, rateLimit } from './store';
import { SecurityError, assertRole, assertSameOrigin } from '../server/security';

export type SessionActor = {id:string;organizationId:string;email:string;fullName:string;role:'admin'|'member'|'viewer';subject:string;issuer:string;organizationName:string};
export const SESSION_COOKIE = '__Host-morph-session';
export const FLOW_COOKIE = '__Host-morph-login';
export function cookie(request:Request,name:string) {
  return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
}
export function secureCookie(name:string, value:string, age:number) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`; }
export function demoMode() { return process.env.MORPH_AUTH_MODE === 'demo' && !process.env.MORPH_GATEWAY_URL; }

export async function requireSession(request:Request, required:'viewer'|'member'|'admin'='viewer'):Promise<SessionActor> {
  if (demoMode()) {
    const actor:SessionActor = {id:'demo-kiran',organizationId:'org_atlas_insurance',email:'kiran@atlas.example',fullName:'Kiran S.',role:'admin',subject:'demo-kiran',issuer:'secure-demo',organizationName:'Atlas Insurance'};
    if (request.method !== 'GET') assertSameOrigin(request,new URL(request.url).origin);
    return actor;
  }
  if (process.env.MORPH_AUTH_MODE !== 'oidc') throw new SecurityError(503,'auth_configuration','Choose an authentication mode before using MorphUI.');
  const config = authConfig();
  if (request.method !== 'GET') assertSameOrigin(request,config.origin);
  const token = cookie(request,SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new SecurityError(401,'sign_in_required','Please sign in to continue.');
  const db = await authDb();
  const session = await db.prepare('SELECT user_id, issuer, subject, organization_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(await hashToken(token),Math.floor(Date.now()/1000)).first<{user_id:string;issuer:string;subject:string;organization_id:string}>();
  if (!session) throw new SecurityError(401,'session_expired','Your session expired. Please sign in again.');
  let membership;
  try {membership=resolveMembership(session.issuer,session.subject);} catch {throw new SecurityError(401,'session_revoked','Your organization membership is no longer active. Please sign in again.');}
  if (membership.organizationId !== session.organization_id) throw new SecurityError(401,'session_revoked','Please sign in again.');
  const user = await db.prepare('SELECT email, full_name FROM app_users WHERE id = ? AND organization_id = ?').bind(session.user_id,membership.organizationId).first<{email:string;full_name:string}>();
  if (!user) throw new SecurityError(401,'session_revoked','Please sign in again.');
  assertRole(membership.role,required);
  return {id:session.user_id,organizationId:membership.organizationId,organizationName:membership.organizationName,email:user.email,fullName:user.full_name,role:membership.role,subject:session.subject,issuer:session.issuer};
}

export async function guardRequest(request:Request, operation:string, required:'viewer'|'member'|'admin'='viewer', maximum=60) {
  const actor = await requireSession(request,required);
  // Demo calls also consume the shared budget; public demos cannot exhaust AI quotas unchecked.
  await rateLimit(await authDb(),`${actor.organizationId}:${actor.id}:${operation}`,maximum);
  return actor;
}
