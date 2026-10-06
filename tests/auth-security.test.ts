import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { assertSameOrigin, assertRole, readJsonLimited, SecurityError } from '../lib/server/security';
import { verifyLoginIdentity, resolveMembership } from '../lib/auth/oidc';

test('cookie mutations reject absent, foreign and null origins', () => {
  for (const origin of [undefined, 'https://evil.example', 'null']) {
    assert.throws(() => assertSameOrigin(new Request('https://morph.example/api', {method:'POST', headers:origin ? {origin} : {}}), 'https://morph.example'), SecurityError);
  }
  assert.doesNotThrow(() => assertSameOrigin(new Request('https://morph.example/api', {method:'POST', headers:{origin:'https://morph.example'}}), 'https://morph.example'));
});
test('viewers cannot mutate and members cannot administer', () => {
  assert.throws(() => assertRole('viewer', 'member'), SecurityError);
  assert.throws(() => assertRole('member', 'admin'), SecurityError);
  assert.doesNotThrow(() => assertRole('admin', 'member'));
});
test('streamed request bodies obey the byte limit without trusting content length', async () => {
  await assert.rejects(readJsonLimited(new Request('https://morph.example', {method:'POST', body:'"'+'a'.repeat(65_536)+'"', headers:{'Content-Type':'application/json'}})), (e:unknown) => e instanceof SecurityError && e.status === 413);
});
test('OIDC identity requires signature, nonce, audience, issuer and verified email', async () => {
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  const key = createLocalJWKSet({keys:[{...await exportJWK(publicKey), kid:'test'}]});
  const config = {issuer:'https://id.example', clientId:'morph'};
  const token = async (overrides = {}) => new SignJWT({email:'member@example.test', email_verified:true, nonce:'nonce', ...overrides}).setProtectedHeader({alg:'RS256', kid:'test'}).setIssuer(config.issuer).setAudience(config.clientId).setSubject('subject-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.equal((await verifyLoginIdentity(await token(), 'nonce', config, key)).sub, 'subject-1');
  await assert.rejects(verifyLoginIdentity(await token(), 'wrong-nonce', config, key));
  await assert.rejects(verifyLoginIdentity(await token({email_verified:false}), 'nonce', config, key));
  await assert.rejects(verifyLoginIdentity(await token(), 'nonce', {...config, clientId:'wrong'}, key));
});
test('membership is server-owned, not derived from email or token roles', () => {
  const mappings = [{issuer:'https://id.example', subject:'s1', organizationId:'org_one', organizationName:'One', role:'member' as const}];
  assert.equal(resolveMembership('https://id.example','s1',mappings).role,'member');
  assert.throws(() => resolveMembership('https://id.example','s2',mappings), SecurityError);
  assert.throws(() => resolveMembership('https://other.example','s1',mappings), SecurityError);
});
