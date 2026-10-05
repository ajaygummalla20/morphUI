import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";

const oidcHeaderSchema = z
  .object({
    alg: z.literal("RS256"),
    kid: z.string().min(1).max(200),
    typ: z.string().max(30).optional(),
  })
  .passthrough();

const audienceSchema = z.union([
  z.string().min(1).max(500),
  z.array(z.string().min(1).max(500)).min(1).max(10),
]);

const oidcClaimsSchema = z
  .object({
    iss: z.string().url().max(500),
    aud: audienceSchema,
    azp: z.string().min(1).max(500).optional(),
    sub: z.string().min(1).max(500),
    email: z.string().email().max(320),
    email_verified: z.literal(true),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    nbf: z.number().int().positive().optional(),
    jti: z.string().min(8).max(500),
    org_id: z.string().min(3).max(100),
  })
  .passthrough();

const jwkSchema = z
  .object({
    kty: z.literal("RSA"),
    kid: z.string().min(1).max(200),
    n: z.string().min(16),
    e: z.string().min(1),
    alg: z.literal("RS256").optional(),
    use: z.literal("sig").optional(),
  })
  .passthrough();

const jwksSchema = z.object({
  keys: z.array(jwkSchema).min(1).max(50),
});

export type IdentityReasonCode =
  | "identity_assertion_expired"
  | "identity_assertion_invalid"
  | "identity_assertion_replayed"
  | "identity_not_verified";

export type VerifiedGatewayIdentity = {
  organizationId: string;
  subjectId: string;
  email: string;
  identityProvider: "oidc";
  issuer: string;
  expiresAt: string;
  jti: string;
};

export type IdentityVerificationContext = {
  organizationId: string;
  requestId: string;
};

export type IdentityVerifier = (
  assertion: string,
  context: IdentityVerificationContext,
) => Promise<VerifiedGatewayIdentity>;

export type OidcIdentityConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  maximumTokenAgeSeconds: number;
  clockToleranceSeconds: number;
  jwksCacheSeconds: number;
};

export class IdentityVerificationError extends Error {
  constructor(
    readonly reasonCode: IdentityReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export function createOidcIdentityVerifier(
  config: OidcIdentityConfig,
  options: {
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
): IdentityVerifier {
  const fetchJwks = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const usedAssertions = new Map<string, number>();
  let cachedKeys:
    | { expiresAtMs: number; keys: Map<string, KeyObject> }
    | undefined;

  async function loadKeys(forceRefresh = false) {
    const currentTime = now();
    if (!forceRefresh && cachedKeys && cachedKeys.expiresAtMs > currentTime) {
      return cachedKeys.keys;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchJwks(config.jwksUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new IdentityVerificationError(
          "identity_not_verified",
          "The client identity signing keys are unavailable.",
        );
      }
      const jwks = jwksSchema.parse(await response.json());
      const keys = new Map<string, KeyObject>();
      for (const jwk of jwks.keys) {
        if (jwk.use && jwk.use !== "sig") continue;
        if (jwk.alg && jwk.alg !== "RS256") continue;
        keys.set(
          jwk.kid,
          createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
        );
      }
      if (!keys.size) {
        throw new IdentityVerificationError(
          "identity_not_verified",
          "The client identity provider has no approved signing key.",
        );
      }
      cachedKeys = {
        keys,
        expiresAtMs: currentTime + config.jwksCacheSeconds * 1_000,
      };
      return keys;
    } catch (error) {
      if (error instanceof IdentityVerificationError) throw error;
      throw new IdentityVerificationError(
        "identity_not_verified",
        "The client identity signing keys could not be verified.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return async (assertion, context) => {
    const parts = assertion.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw invalidAssertion();
    }

    let header: z.infer<typeof oidcHeaderSchema>;
    let claims: z.infer<typeof oidcClaimsSchema>;
    try {
      header = oidcHeaderSchema.parse(decodeJson(parts[0]));
      claims = oidcClaimsSchema.parse(decodeJson(parts[1]));
    } catch {
      throw invalidAssertion();
    }

    let keys = await loadKeys();
    let publicKey = keys.get(header.kid);
    if (!publicKey) {
      keys = await loadKeys(true);
      publicKey = keys.get(header.kid);
    }
    if (!publicKey) throw invalidAssertion();

    const signedContent = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], "base64url");
    if (!verifySignature("RSA-SHA256", signedContent, publicKey, signature)) {
      throw invalidAssertion();
    }

    const currentSeconds = Math.floor(now() / 1_000);
    const tolerance = config.clockToleranceSeconds;
    if (claims.iss !== config.issuer) throw invalidAssertion();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.audience)) throw invalidAssertion();
    if (audiences.length > 1 && claims.azp !== config.audience) {
      throw invalidAssertion();
    }
    if (claims.exp <= currentSeconds - tolerance) {
      throw new IdentityVerificationError(
        "identity_assertion_expired",
        "The client identity assertion has expired.",
      );
    }
    if (claims.iat > currentSeconds + tolerance) throw invalidAssertion();
    if (
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > config.maximumTokenAgeSeconds + tolerance
    ) {
      throw invalidAssertion();
    }
    if (claims.nbf && claims.nbf > currentSeconds + tolerance) {
      throw invalidAssertion();
    }
    if (
      currentSeconds - claims.iat >
      config.maximumTokenAgeSeconds + tolerance
    ) {
      throw new IdentityVerificationError(
        "identity_assertion_expired",
        "The client identity assertion is older than the allowed lifetime.",
      );
    }
    if (claims.org_id !== context.organizationId) throw invalidAssertion();
    purgeExpiredAssertions(usedAssertions, currentSeconds);
    const replayKey = `${claims.iss}:${claims.jti}`;
    if ((usedAssertions.get(replayKey) ?? 0) > currentSeconds) {
      throw new IdentityVerificationError(
        "identity_assertion_replayed",
        "The client identity assertion has already been used.",
      );
    }
    while (usedAssertions.size >= 10_000) {
      const oldest = usedAssertions.keys().next().value;
      if (typeof oldest !== "string") break;
      usedAssertions.delete(oldest);
    }
    usedAssertions.set(replayKey, claims.exp);

    return {
      organizationId: claims.org_id,
      subjectId: claims.sub,
      email: claims.email.toLowerCase(),
      identityProvider: "oidc",
      issuer: claims.iss,
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      jti: claims.jti,
    };
  };
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function invalidAssertion() {
  return new IdentityVerificationError(
    "identity_assertion_invalid",
    "The client identity assertion could not be verified.",
  );
}

function purgeExpiredAssertions(
  assertions: Map<string, number>,
  currentSeconds: number,
) {
  for (const [key, expiresAt] of assertions) {
    if (expiresAt <= currentSeconds) assertions.delete(key);
  }
}
