import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  GatewayCatalogRequest,
  GatewayExecuteRequest,
} from "../../lib/gateway/contract.js";
import type { GatewayConfig } from "../src/config.js";
import { gatewayPolicySchema } from "../src/policy.js";
import { createGatewayServer } from "../src/server.js";
import { IdentityVerificationError } from "../src/identity.js";

const token = "test-morph-gateway-token-123456";
const config: GatewayConfig = {
  port: 8788,
  databaseUrl: "postgresql://unused.example/test",
  serviceToken: token,
  policyPath: "config/policy.example.json",
  gatewayId: "test-gateway",
  auditHashSalt: "test-audit-hash-salt-123456",
  identity: {
    issuer: "https://identity.atlas.example",
    audience: "morph-gateway",
    jwksUrl: "https://identity.atlas.example/.well-known/jwks.json",
    maximumTokenAgeSeconds: 300,
    clockToleranceSeconds: 30,
    jwksCacheSeconds: 300,
  },
};
const policy = gatewayPolicySchema.parse(
  JSON.parse(await readFile("config/policy.example.json", "utf8")),
);

test("the HTTP service authenticates, enforces policy and masks database rows", async () => {
  let compiledSql = "";
  const catalogProbes: string[] = [];
  const server = createGatewayServer({
    config,
    policy,
    execute: async (query) => {
      if (/LIMIT 0$/.test(query.text)) {
        catalogProbes.push(query.text);
        return [];
      }
      compiledSql = query.text;
      return [
        {
          claim_number: "CLM-1001",
          customer_name: "Aarav Logistics",
          claimed_amount: 125_000,
        },
      ];
    },
    verifyIdentity: async (assertion, context) => {
      assert.equal(
        assertion,
        "test-identity-assertion-that-is-long-enough-for-contract",
      );
      assert.equal(context.organizationId, "org_atlas_insurance");
      return {
        organizationId: "org_atlas_insurance",
        subjectId: "subject-kiran",
        email: "kiran@atlas.example",
        identityProvider: "oidc",
        issuer: "https://identity.atlas.example",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        jti: "test-jti-kiran",
      };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/v1/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).protocolVersion, "1.2");

    const request: GatewayExecuteRequest = {
      protocolVersion: "1.2",
      requestId: crypto.randomUUID(),
      connectorId: "connector_production_postgresql",
      identity: {
        organizationId: "org_atlas_insurance",
        assertion: "test-identity-assertion-that-is-long-enough-for-contract",
      },
      plan: {
        source: "claims_read_replica",
        catalogVersion: "insurance-catalog-2026-09-01",
        operation: "select",
        entity: "claims",
        fields: ["claim_number", "customer_name", "claimed_amount"],
        filters: [
          {
            field: "claimed_amount",
            operator: "greater_than",
            value: 50_000,
          },
        ],
        orderBy: [],
        rowLimit: 20,
      },
    };
    const execution = await fetch(`${baseUrl}/v1/query-plans/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    assert.equal(execution.status, 200);
    const result = await execution.json();
    assert.equal(result.decision, "allow");
    assert.equal(result.identityVerified, true);
    assert.equal(result.identityProvider, "oidc");
    assert.equal(result.identityIssuer, "https://identity.atlas.example");
    assert.deepEqual(result.maskedFields, ["customer_name"]);
    assert.equal(result.rows[0].customer_name, "A•••••• customer");
    assert.match(compiledSql, /cl\.claimed_amount > \$1/);

    const catalogRequest: GatewayCatalogRequest = {
      protocolVersion: "1.2",
      requestId: crypto.randomUUID(),
      connectorId: "connector_production_postgresql",
      identity: {
        organizationId: "org_atlas_insurance",
        assertion: "test-identity-assertion-that-is-long-enough-for-contract",
      },
    };
    const catalogResponse = await fetch(`${baseUrl}/v1/catalog/discover`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(catalogRequest),
    });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.connectionStatus, "ready");
    assert.equal(catalog.identityVerified, true);
    assert.equal(catalog.entities.length, 3);
    assert.deepEqual(
      catalog.entities.map((entity: { entity: string }) => entity.entity),
      ["policies", "claims", "endorsements"],
    );
    assert.equal(catalogProbes.length, 3);
    assert.ok(catalogProbes.every((query) => /LIMIT 0$/.test(query)));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("an unverified identity is denied before database execution", async () => {
  let databaseCalled = false;
  const server = createGatewayServer({
    config,
    policy,
    execute: async () => {
      databaseCalled = true;
      return [];
    },
    verifyIdentity: async () => {
      throw new IdentityVerificationError(
        "identity_assertion_expired",
        "The client identity assertion has expired.",
      );
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const request: GatewayExecuteRequest = {
      protocolVersion: "1.2",
      requestId: crypto.randomUUID(),
      connectorId: "connector_production_postgresql",
      identity: {
        organizationId: "org_atlas_insurance",
        assertion: "expired-identity-assertion-that-is-long-enough-for-contract",
      },
      plan: {
        source: "claims_read_replica",
        catalogVersion: "insurance-catalog-2026-09-01",
        operation: "select",
        entity: "claims",
        fields: ["claim_number"],
        filters: [],
        orderBy: [],
        rowLimit: 20,
      },
    };
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/query-plans/execute`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    const result = await response.json();
    assert.equal(response.status, 403);
    assert.equal(result.decision, "deny");
    assert.equal(result.reasonCode, "identity_assertion_expired");
    assert.equal(databaseCalled, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("member catalog access separates runtime metadata from administrator onboarding", async (t) => {
  const databaseQueries: string[] = [];
  const server = createGatewayServer({
    config,
    policy,
    execute: async (query) => {
      databaseQueries.push(query.text);
      return [];
    },
    verifyIdentity: async () => ({
      organizationId: policy.organizationId,
      subjectId: "subject-operations-member",
      email: "member@atlas.example",
      identityProvider: "oidc",
      issuer: config.identity.issuer,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      jti: crypto.randomUUID(),
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const discover = (purpose: "runtime" | "onboarding") => fetch(`http://127.0.0.1:${port}/v1/catalog/discover`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "1.2", requestId: crypto.randomUUID(), connectorId: policy.connectorId,
      purpose,
      identity: {
        organizationId: policy.organizationId,
        assertion: "verified-member-identity-assertion-long-enough-for-contract",
      },
    } satisfies GatewayCatalogRequest),
  });
  try {
    await t.test("a member cannot onboard connectors or cause schema probes", async () => {
      const onboarding = await discover("onboarding");
      assert.equal(onboarding.status, 403);
      const denial = await onboarding.json();
      assert.equal(denial.decision, "deny");
      assert.equal(denial.reasonCode, "onboarding_not_allowed");
      assert.deepEqual(databaseQueries, [], "denied onboarding must not execute database probes");
    });

    await t.test("runtime catalog includes only the member's allowed entities without schema probes", async () => {
      const response = await discover("runtime");
      assert.equal(response.status, 200);
      const catalog = await response.json();
      assert.equal(catalog.decision, "allow");
      assert.deepEqual(catalog.entities.map((entity: { entity: string }) => entity.entity), ["policies", "endorsements"]);
      assert.ok(catalog.entities.every((entity: { schemaVerified: boolean }) => entity.schemaVerified === false));
      const allowed = new Set(["policies", "endorsements"]);
      assert.ok(catalog.relationships.every((relationship: { fromEntity: string; toEntity: string }) => allowed.has(relationship.fromEntity) && allowed.has(relationship.toEntity)));
      assert.deepEqual(databaseQueries, [], "runtime metadata discovery must not probe database schemas");
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
