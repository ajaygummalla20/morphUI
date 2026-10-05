import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GatewayExecuteRequest } from "../../lib/gateway/contract.js";
import type { VerifiedGatewayIdentity } from "../src/identity.js";
import {
  evaluateOnboardingPolicy,
  evaluatePolicy,
  gatewayPolicySchema,
} from "../src/policy.js";

const policy = gatewayPolicySchema.parse(
  JSON.parse(await readFile("config/policy.example.json", "utf8")),
);

const claimsRequest: GatewayExecuteRequest = {
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

const analystIdentity: VerifiedGatewayIdentity = {
  organizationId: "org_atlas_insurance",
  subjectId: "subject-1",
  email: "analyst@atlas.example",
  identityProvider: "oidc",
  issuer: "https://identity.atlas.example",
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  jti: "test-jti-analyst",
};

test("an unmapped verified identity cannot claim a privileged group", () => {
  const decision = evaluatePolicy(claimsRequest, policy, analystIdentity);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reasonCode, "entity_not_allowed");
});

test("an explicitly mapped client identity receives its client-owned groups", () => {
  const decision = evaluatePolicy(
    claimsRequest,
    policy,
    { ...analystIdentity, email: "kiran@atlas.example" },
  );
  assert.equal(decision.allowed, true);
  if (decision.allowed) assert.deepEqual(decision.groups, ["Workspace admins"]);
});

test("unknown organizations and connectors are denied", () => {
  const wrongOrganization = evaluatePolicy(
    {
      ...claimsRequest,
      identity: {
        ...claimsRequest.identity,
        organizationId: "org_untrusted",
      },
    },
    policy,
    analystIdentity,
  );
  assert.equal(wrongOrganization.allowed, false);
  if (!wrongOrganization.allowed) {
    assert.equal(wrongOrganization.reasonCode, "organization_not_allowed");
  }

  const wrongConnector = evaluatePolicy(
    {
      ...claimsRequest,
      connectorId: "connector_untrusted",
    },
    policy,
    analystIdentity,
  );
  assert.equal(wrongConnector.allowed, false);
  if (!wrongConnector.allowed) {
    assert.equal(wrongConnector.reasonCode, "connector_not_allowed");
  }
});

test("catalog onboarding requires a client-owned administrator group", () => {
  const denied = evaluateOnboardingPolicy(
    claimsRequest,
    policy,
    analystIdentity,
  );
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.reasonCode, "onboarding_not_allowed");
  }

  const allowed = evaluateOnboardingPolicy(
    claimsRequest,
    policy,
    { ...analystIdentity, email: "kiran@atlas.example" },
  );
  assert.equal(allowed.allowed, true);
});
