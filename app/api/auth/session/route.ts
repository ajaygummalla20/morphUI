import { demoMode, requireSession } from '@/lib/auth/session';
import { securityResponse } from '@/lib/server/security';
export async function GET(request:Request) {
  try {
    const actor = await requireSession(request);
    return Response.json({mode:demoMode()?'demo':'oidc',user:{id:actor.id,organizationId:actor.organizationId,fullName:actor.fullName,role:actor.role}},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return securityResponse(error) ?? Response.json({error:'Sign-in is unavailable.'},{status:503}); }
}
