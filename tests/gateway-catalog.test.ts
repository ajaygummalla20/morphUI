import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/gateway/catalog/route";

test("the onboarding catalog returns only approved demo metadata", async () => {
  const previousGatewayUrl = process.env.MORPH_GATEWAY_URL;
  delete process.env.MORPH_GATEWAY_URL;

  try {
    const response = await POST(
      new Request("http://localhost/api/gateway/catalog", { method: "POST",headers:{Origin:"http://localhost"} }),
    );
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.equal(catalog.sourceMode, "secure_demo");
    assert.equal(catalog.connectionStatus, "ready");
    assert.equal(catalog.identityVerified, true);
    assert.deepEqual(
      catalog.entities.map((entity: { entity: string }) => entity.entity),
      ["policies", "claims", "endorsements"],
    );
    assert.ok(
      catalog.entities.every(
        (entity: { schemaVerified: boolean; accessMode: string }) =>
          entity.schemaVerified && entity.accessMode === "read_only",
      ),
    );
    assert.equal(JSON.stringify(catalog).includes("password"), false);
    assert.equal(JSON.stringify(catalog).includes("rows"), false);
  } finally {
    process.env.MORPH_AUTH_MODE="demo";
    if (previousGatewayUrl === undefined) delete process.env.MORPH_GATEWAY_URL;
    else process.env.MORPH_GATEWAY_URL = previousGatewayUrl;
  }
});

test("a real Gateway catalog fails closed without client identity", async () => {
  const previousGatewayUrl = process.env.MORPH_GATEWAY_URL;
  process.env.MORPH_GATEWAY_URL = "https://gateway.atlas.example";
  process.env.MORPH_AUTH_MODE="oidc";

  try {
    const response = await POST(
      new Request("http://localhost/api/gateway/catalog", { method: "POST",headers:{Origin:"http://localhost"} }),
    );
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.code, "invalid_origin");
  } finally {
    process.env.MORPH_AUTH_MODE="demo";
    if (previousGatewayUrl === undefined) delete process.env.MORPH_GATEWAY_URL;
    else process.env.MORPH_GATEWAY_URL = previousGatewayUrl;
  }
});
