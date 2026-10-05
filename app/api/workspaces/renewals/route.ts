import { ZodError } from "zod";
import { parseRenewalWorkspaceFilters } from "@/lib/workspaces/renewals";
import { POST as generateWorkspace } from "../generate/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const filters = parseRenewalWorkspaceFilters(
      new URL(request.url).searchParams,
    );
    const prompt = `Show motor policies expiring in the next ${filters.days} days above ₹${filters.minimumPremium}`;
    const forwardedHeaders = new Headers({ "Content-Type": "application/json" });
    for (const header of [
      "oai-authenticated-user-id",
      "oai-authenticated-user-email",
    ]) {
      const value = request.headers.get(header);
      if (value) forwardedHeaders.set(header, value);
    }
    const response = await generateWorkspace(
      new Request(new URL("/api/workspaces/generate", request.url), {
        method: "POST",
        headers: forwardedHeaders,
        body: JSON.stringify({ prompt, limit: filters.limit }),
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("Deprecation", "true");
    headers.set("Link", '</api/workspaces/generate>; rel="successor-version"');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid renewal workspace filters" },
        { status: 400 },
      );
    }
    throw error;
  }
}
