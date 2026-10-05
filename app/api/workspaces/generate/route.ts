import { ZodError } from "zod";
import {
  GatewayDeniedError,
  GatewayIdentityRequiredError,
  GatewayProtocolError,
  discoverGatewayCatalog,
  executeWorkspaceGateway,
  gatewayIdentityFromRequest,
} from "@/lib/gateway/client";
import {
  applyGatewayDecision,
  buildCatalogDrivenWorkspace,
  createWorkspaceQueryPlan,
  dynamicWorkspaceRequestSchema,
  UnsupportedWorkspaceRequestError,
} from "@/lib/workspaces/dynamic";
import { planWorkspaceRequestWithAi } from "@/lib/workspaces/ai-planner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = performance.now();

  try {
    const input = dynamicWorkspaceRequestSchema.parse(await request.json());
    const identity = gatewayIdentityFromRequest(request);
    const discovery = await discoverGatewayCatalog({ identity });
    const plannerResult = await planWorkspaceRequestWithAi(
      input.prompt,
      discovery.catalog,
      input.limit,
    );
    const plan = plannerResult.plan;
    const queryPlan = createWorkspaceQueryPlan(plan);
    const catalogEntity = discovery.catalog.entities.find(
      (entity) => entity.entity === plan.entity,
    );
    if (!catalogEntity) {
      throw new GatewayProtocolError(
        "The requested entity is unavailable in the approved Gateway catalogue.",
      );
    }
    const execution = await executeWorkspaceGateway({
      plan,
      queryPlan,
      identity,
      catalogEntity,
    });
    const response = {
      ...applyGatewayDecision(
        buildCatalogDrivenWorkspace({
          plan,
          entity: catalogEntity,
          records: execution.records,
          sourceMode: execution.sourceMode,
          generatedInMs: performance.now() - startedAt,
        }),
        execution.decision,
        execution.sourceMode,
      ),
      planner: plannerResult.planner,
    };

    return Response.json(response, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Morph-Data-Mode": execution.sourceMode,
        "X-Morph-Policy-Version": execution.decision.policyVersion,
        "X-Morph-Decision-Id": execution.decision.decisionId,
        "X-Morph-Planner-Mode": plannerResult.planner.mode,
      },
    });
  } catch (error) {
    if (error instanceof GatewayIdentityRequiredError) {
      return Response.json(
        {
          error: error.message,
          code: "client_identity_required",
        },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        },
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
    if (error instanceof UnsupportedWorkspaceRequestError) {
      return Response.json(
        {
          error: error.message,
          code: "unsupported_workspace_request",
          suggestions: error.suggestions,
        },
        { status: 422 },
      );
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json(
        {
          error: "The workspace request is invalid.",
          code: "invalid_workspace_request",
        },
        { status: 400 },
      );
    }
    if (error instanceof GatewayProtocolError) {
      console.error("Gateway protocol validation failed", error);
      return Response.json(
        {
          error:
            "The client Gateway returned an invalid response. No data was displayed.",
          code: "gateway_protocol_error",
        },
        { status: 502 },
      );
    }

    console.error("Dynamic workspace generation failed", error);
    return Response.json(
      {
        error:
          "The client Gateway is temporarily unavailable. No partial data was returned.",
        code: "gateway_unavailable",
      },
      { status: 503 },
    );
  }
}
