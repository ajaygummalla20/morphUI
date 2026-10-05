import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { OidcIdentityConfig } from "./identity.js";
import { gatewayPolicySchema, type GatewayPolicy } from "./policy.js";

const httpsUrlSchema = z.string().url().refine(
  (value) => new URL(value).protocol === "https:",
  "Client identity endpoints must use HTTPS.",
);

const gatewayConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  databaseUrl: z.string().url(),
  serviceToken: z.string().min(24),
  policyPath: z.string().min(1),
  gatewayId: z.string().regex(/^[a-z0-9_-]+$/).max(100),
  auditHashSalt: z.string().min(16),
  identity: z.object({
    issuer: httpsUrlSchema,
    audience: z.string().min(3).max(500),
    jwksUrl: httpsUrlSchema,
    maximumTokenAgeSeconds: z.number().int().min(30).max(900),
    clockToleranceSeconds: z.number().int().min(0).max(120),
    jwksCacheSeconds: z.number().int().min(30).max(3_600),
  }) satisfies z.ZodType<OidcIdentityConfig>,
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export async function loadGatewayConfig(): Promise<{
  config: GatewayConfig;
  policy: GatewayPolicy;
}> {
  const config = gatewayConfigSchema.parse({
    port: Number(process.env.PORT ?? 8788),
    databaseUrl: process.env.DATABASE_URL,
    serviceToken: process.env.MORPH_GATEWAY_SERVICE_TOKEN,
    policyPath: process.env.MORPH_GATEWAY_POLICY_PATH ?? "config/policy.json",
    gatewayId: process.env.MORPH_GATEWAY_ID ?? "morph-gateway",
    auditHashSalt: process.env.MORPH_GATEWAY_AUDIT_HASH_SALT,
    identity: {
      issuer: process.env.MORPH_GATEWAY_OIDC_ISSUER,
      audience: process.env.MORPH_GATEWAY_OIDC_AUDIENCE,
      jwksUrl: process.env.MORPH_GATEWAY_OIDC_JWKS_URL,
      maximumTokenAgeSeconds: Number(
        process.env.MORPH_GATEWAY_OIDC_MAX_TOKEN_AGE_SECONDS ?? 300,
      ),
      clockToleranceSeconds: Number(
        process.env.MORPH_GATEWAY_OIDC_CLOCK_TOLERANCE_SECONDS ?? 30,
      ),
      jwksCacheSeconds: Number(
        process.env.MORPH_GATEWAY_OIDC_JWKS_CACHE_SECONDS ?? 300,
      ),
    },
  });
  const policyText = await readFile(resolve(config.policyPath), "utf8");
  const policy = gatewayPolicySchema.parse(JSON.parse(policyText));
  return { config, policy };
}
