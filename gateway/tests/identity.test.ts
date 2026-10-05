import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createOidcIdentityVerifier,
  IdentityVerificationError,
  type OidcIdentityConfig,
} from "../src/identity.js";

const nowSeconds = 2_000_000_000;
const issuer = "https://identity.atlas.example";
const audience = "morph-gateway";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const { privateKey: untrustedPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "atlas-key-1",
  alg: "RS256",
  use: "sig",
};

const config: OidcIdentityConfig = {
  issuer,
  audience,
  jwksUrl: `${issuer}/.well-known/jwks.json`,
  maximumTokenAgeSeconds: 300,
  clockToleranceSeconds: 5,
  jwksCacheSeconds: 300,
};

function createVerifier() {
  return createOidcIdentityVerifier(config, {
    now: () => nowSeconds * 1_000,
    fetch: async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
}

function createAssertion(
  overrides: Record<string, unknown> = {},
  signingKey = privateKey,
) {
  const header = encode({ alg: "RS256", kid: "atlas-key-1", typ: "JWT" });
  const payload = encode({
    iss: issuer,
    aud: audience,
    sub: "atlas-user-204",
    email: "kiran@atlas.example",
    email_verified: true,
    exp: nowSeconds + 240,
    iat: nowSeconds,
    nbf: nowSeconds - 1,
    jti: "identity-jti-0001",
    org_id: "org_atlas_insurance",
    ...overrides,
  });
  const content = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(content), signingKey);
  return `${content}.${signature.toString("base64url")}`;
}

test("verifies a signed short-lived OIDC assertion and rejects replay", async () => {
  const verifyIdentity = createVerifier();
  const assertion = createAssertion();
  const context = {
    organizationId: "org_atlas_insurance",
    requestId: crypto.randomUUID(),
  };

  const identity = await verifyIdentity(assertion, context);
  assert.equal(identity.subjectId, "atlas-user-204");
  assert.equal(identity.email, "kiran@atlas.example");
  assert.equal(identity.issuer, issuer);

  await assert.rejects(
    () => verifyIdentity(assertion, context),
    (error: unknown) =>
      error instanceof IdentityVerificationError &&
      error.reasonCode === "identity_assertion_replayed",
  );
});

test("rejects bad signatures, expired assertions and organization mismatch", async () => {
  await assert.rejects(
    () =>
      createVerifier()(
        createAssertion({ jti: "identity-jti-bad-signature" }, untrustedPrivateKey),
        {
          organizationId: "org_atlas_insurance",
          requestId: crypto.randomUUID(),
        },
      ),
    (error: unknown) =>
      error instanceof IdentityVerificationError &&
      error.reasonCode === "identity_assertion_invalid",
  );

  await assert.rejects(
    () =>
      createVerifier()(
        createAssertion({
          exp: nowSeconds - 60,
          iat: nowSeconds - 120,
          jti: "identity-jti-expired",
        }),
        {
          organizationId: "org_atlas_insurance",
          requestId: crypto.randomUUID(),
        },
      ),
    (error: unknown) =>
      error instanceof IdentityVerificationError &&
      error.reasonCode === "identity_assertion_expired",
  );

  await assert.rejects(
    () =>
      createVerifier()(
        createAssertion({ jti: "identity-jti-wrong-org" }),
        {
          organizationId: "org_untrusted",
          requestId: crypto.randomUUID(),
        },
      ),
    (error: unknown) =>
      error instanceof IdentityVerificationError &&
      error.reasonCode === "identity_assertion_invalid",
  );

  await assert.rejects(
    () =>
      createVerifier()(
        createAssertion({
          exp: nowSeconds + 3_600,
          jti: "identity-jti-overlong",
        }),
        {
          organizationId: "org_atlas_insurance",
          requestId: crypto.randomUUID(),
        },
      ),
    (error: unknown) =>
      error instanceof IdentityVerificationError &&
      error.reasonCode === "identity_assertion_invalid",
  );
});

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
