import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { SecurityError } from '../server/security';

export const membershipSchema = z.object({
  issuer: z.url(), subject:z.string().min(1).max(500),
  organizationId:z.string().regex(/^[a-zA-Z0-9_-]{3,100}$/),
  organizationName:z.string().min(1).max(100),
  role:z.enum(['admin','member','viewer']),
});
export type Membership = z.infer<typeof membershipSchema>;

export function memberships(): Membership[] {
  try { return z.array(membershipSchema).max(1000).parse(JSON.parse(process.env.MORPH_AUTH_MEMBERSHIPS ?? '[]')); }
  catch { throw new SecurityError(503,'auth_configuration','Sign-in configuration is unavailable.'); }
}

export function resolveMembership(issuer: string, subject: string, mappings = memberships()) {
  const matches = mappings.filter(m => m.issuer === issuer && m.subject === subject);
  if (matches.length !== 1) throw new SecurityError(403,'membership_required','Your account has no active organization membership.');
  return matches[0];
}

export function authConfig() {
  const required = (key:string) => {
    const value = process.env[key]?.trim();
    if (!value) throw new SecurityError(503,'auth_configuration','Sign-in has not been configured by the administrator.');
    return value;
  };
  const secureUrl = (key:string) => {
    const value = required(key);
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new SecurityError(503,'auth_configuration','Sign-in requires secure configured endpoints.');
    return value;
  };
  const origin = new URL(secureUrl('MORPH_APP_ORIGIN')).origin;
  return {
    origin, issuer:secureUrl('MORPH_OIDC_ISSUER'),
    authorizationUrl:secureUrl('MORPH_OIDC_AUTHORIZATION_URL'),
    tokenUrl:secureUrl('MORPH_OIDC_TOKEN_URL'), jwksUrl:secureUrl('MORPH_OIDC_JWKS_URL'),
    clientId:required('MORPH_OIDC_CLIENT_ID'), clientSecret:required('MORPH_OIDC_CLIENT_SECRET'),
    redirectUri:`${origin}/api/auth/callback`,
  };
}

const keySets = new Map<string, JWTVerifyGetKey>();
export async function verifyLoginIdentity(token:string, nonce:string, config:{issuer:string;clientId:string;jwksUrl?:string}, getKey?:JWTVerifyGetKey) {
  if (!getKey) {
    if (!config.jwksUrl) throw new Error('Missing JWKS configuration');
    getKey = keySets.get(config.jwksUrl);
    if (!getKey) {
      getKey = createRemoteJWKSet(new URL(config.jwksUrl), {timeoutDuration:5000, cooldownDuration:30_000});
      keySets.set(config.jwksUrl, getKey);
    }
  }
  const {payload} = await jwtVerify(token,getKey,{issuer:config.issuer,audience:config.clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce'],maxTokenAge:'10m',clockTolerance:5});
  if (payload.nonce !== nonce || payload.email_verified !== true || typeof payload.email !== 'string' || !z.email().safeParse(payload.email).success ||
    (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)) {
    throw new SecurityError(401,'identity_invalid','The sign-in identity could not be verified.');
  }
  return {issuer:config.issuer,sub:payload.sub!,email:payload.email.toLowerCase(),name:typeof payload.name === 'string' ? payload.name.slice(0,100) : payload.email};
}
