import { cookie, SESSION_COOKIE, secureCookie, demoMode } from '@/lib/auth/session';
import { authConfig } from '@/lib/auth/oidc';
import { authDb, hashToken } from '@/lib/auth/store';
import { assertSameOrigin, securityResponse } from '@/lib/server/security';
export async function POST(request:Request) {
  try {
    assertSameOrigin(request,demoMode()?new URL(request.url).origin:authConfig().origin);
    const token = cookie(request,SESSION_COOKIE);
    if (token) await (await authDb()).prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
    return new Response(null,{status:204,headers:{'Set-Cookie':secureCookie(SESSION_COOKIE,'',0),'Cache-Control':'no-store','Clear-Site-Data':'"cache", "storage"'}});
  } catch(error) { return securityResponse(error) ?? Response.json({error:'Sign-out could not be completed. Please retry.'},{status:503}); }
}
