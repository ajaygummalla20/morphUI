import {
  GatewayDeniedError,
  GatewayIdentityRequiredError,
  GatewayProtocolError,
  discoverGatewayCatalog,
} from "@/lib/gateway/client";
import { guardRequest } from '@/lib/auth/session';
import { gatewayIdentityFor } from '@/lib/auth/gateway';
import { securityResponse } from '@/lib/server/security';

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await guardRequest(request,'catalog','admin',12);
    const execution = await discoverGatewayCatalog({
      identity: gatewayIdentityFor(actor),
      connectorId:process.env.MORPH_GATEWAY_CONNECTOR_ID,
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
    const denied = securityResponse(error); if (denied) return denied;
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
