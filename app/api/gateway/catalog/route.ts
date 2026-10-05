import {
  GatewayDeniedError,
  GatewayIdentityRequiredError,
  GatewayProtocolError,
  discoverGatewayCatalog,
  gatewayIdentityFromRequest,
} from "@/lib/gateway/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const execution = await discoverGatewayCatalog({
      identity: gatewayIdentityFromRequest(request),
    });
    return Response.json(
      {
        sourceMode: execution.sourceMode,
        ...execution.catalog,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Morph-Data-Mode": execution.sourceMode,
          "X-Morph-Policy-Version": execution.catalog.policyVersion,
          "X-Morph-Decision-Id": execution.catalog.decisionId,
        },
      },
    );
  } catch (error) {
    if (error instanceof GatewayIdentityRequiredError) {
      return Response.json(
        { error: error.message, code: "client_identity_required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof GatewayDeniedError) {
      return Response.json(
        {
          error: error.message,
          code: error.reasonCode,
          decisionId: error.decisionId,
          policyVersion: error.policyVersion,
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
            "X-Morph-Decision-Id": error.decisionId,
          },
        },
      );
    }
    if (error instanceof GatewayProtocolError) {
      return Response.json(
        {
          error: "The client Gateway returned an invalid catalog.",
          code: "gateway_protocol_error",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("Gateway catalog discovery failed", error);
    return Response.json(
      {
        error:
          "The Gateway could not verify the approved database schema. No schema was saved.",
        code: "gateway_catalog_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
