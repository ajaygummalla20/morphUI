import { getGatewayHealth } from "@/lib/gateway/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getGatewayHealth(), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Gateway health check failed", error);
    return Response.json(
      {
        status: "unavailable",
        error: "The client Gateway could not be verified.",
      },
      { status: 503 },
    );
  }
}
