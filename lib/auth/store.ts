import { SecurityError } from '../server/security';

export async function authDb(): Promise<D1Database> {
  const {env} = await import('cloudflare:workers');
  const db = (env as unknown as {DB?:D1Database}).DB;
  if (!db) throw new SecurityError(503,'storage_unavailable','Secure application storage is unavailable.');
  return db;
}
export function randomToken() { return crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''); }
export async function hashToken(token:string) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function rateLimit(db:D1Database, key:string, maximum:number, windowSeconds=60) {
  const now = Math.floor(Date.now()/1000);
  const bucket = Math.floor(now/windowSeconds);
  const id = await hashToken(`${key}:${bucket}`);
  const result = await db.prepare('INSERT INTO request_limits (id, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET hits = hits + 1 RETURNING hits').bind(id,now+windowSeconds*2).first<{hits:number}>();
  if (!result || result.hits > maximum) throw new SecurityError(429,'rate_limited','Too many requests. Please wait a minute and try again.');
  // Bounded opportunistic cleanup, shared by every application instance.
  await db.prepare('DELETE FROM request_limits WHERE id IN (SELECT id FROM request_limits WHERE expires_at < ? LIMIT 100)').bind(now).run();
}
