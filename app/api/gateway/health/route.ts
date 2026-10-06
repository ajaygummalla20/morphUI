import { getGatewayHealth } from "@/lib/gateway/client";
import { guardRequest } from '@/lib/auth/session';
import { securityResponse } from '@/lib/server/security';

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  try {
    await guardRequest(request,'health','admin',30);
    return Response.json(await getGatewayHealth(), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const denied=securityResponse(error); if (denied) return denied;
    return Response.json(
      {
        status: "unavailable",
        error: "The client Gateway could not be verified.",
      },
      { status: 503 },
    );
  }
}
