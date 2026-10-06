import { importJWK, SignJWT } from 'jose';
import type { SessionActor } from './session';
import { demoMode } from './session';
import { SecurityError } from '../server/security';

export function gatewayIdentityFor(actor:SessionActor) {
  return async (requestId:string) => {
    if (demoMode()) return {organizationId:actor.organizationId,assertion:'secure-demo-identity-assertion-not-valid-at-a-client-gateway'};
    // No caller-supplied assertion, email or groups can enter this path.
    const issuer = process.env.MORPH_ASSERTION_ISSUER;
    const audience = process.env.MORPH_ASSERTION_AUDIENCE;
    const privateJwk = process.env.MORPH_ASSERTION_PRIVATE_JWK;
    if (!issuer || !audience || !privateJwk || !process.env.MORPH_GATEWAY_URL || process.env.MORPH_ORGANIZATION_ID !== actor.organizationId) {
      throw new SecurityError(503,'gateway_configuration','This organization has no configured identity bridge to its Gateway.');
    }
    const jwk = JSON.parse(privateJwk);
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.d) throw new SecurityError(503,'gateway_configuration','The Gateway identity bridge is unavailable.');
    const key = await importJWK(jwk,'RS256');
    const assertion = await new SignJWT({email:actor.email,email_verified:true,org_id:actor.organizationId,request_id:requestId})
      .setProtectedHeader({alg:'RS256',kid:jwk.kid,typ:'JWT'}).setIssuer(issuer).setAudience(audience).setSubject(actor.subject)
      .setIssuedAt().setExpirationTime('60s').setJti(crypto.randomUUID()).sign(key);
    return {organizationId:actor.organizationId,assertion};
  };
}
