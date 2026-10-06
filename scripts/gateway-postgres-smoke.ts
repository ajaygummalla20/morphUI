import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import postgres from 'postgres';
import {createGatewayServer} from '../gateway/src/server';
import {createQueryExecutor} from '../gateway/src/database';
import {createOidcIdentityVerifier} from '../gateway/src/identity';
import {gatewayPolicySchema} from '../gateway/src/policy';
import {createWorkspaceQueryPlan,planWorkspaceRequest} from '../lib/workspaces/dynamic';
import {GATEWAY_PROTOCOL_VERSION} from '../lib/gateway/contract';

const url=process.env.MORPH_SMOKE_DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Set MORPH_SMOKE_DATABASE_URL to the local disposable PostgreSQL reader.');
const sql=postgres(url,{max:1});
await assert.rejects(sql`CREATE TABLE forbidden_smoke_write (id integer)`);
const role=await sql`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user`;
assert.ok(!role[0].rolsuper&&!role[0].rolcreaterole&&!role[0].rolcreatedb);
await sql.end();
const policy=gatewayPolicySchema.parse(JSON.parse(readFileSync('gateway/config/policy.example.json','utf8')));
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'ephemeral-smoke-key'};
const identity={issuer:'https://smoke.identity.example',audience:'morph-gateway',jwksUrl:'https://smoke.identity.example/jwks',maximumTokenAgeSeconds:300,clockToleranceSeconds:5,jwksCacheSeconds:300};
const db=createQueryExecutor(url);
const server=createGatewayServer({config:{port:0,databaseUrl:url,serviceToken:'ephemeral-smoke-service-token-123456',gatewayId:'smoke',policyPath:'unused',auditHashSalt:'smoke-audit-hash-salt-123456',identity},policy,execute:db.execute,verifyIdentity:createOidcIdentityVerifier(identity,{fetch:async()=>Response.json({keys:[jwk]})})});
server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();if(!address||typeof address==='string')throw new Error('No port');
const endpoint=`http://127.0.0.1:${address.port}`;
async function send(path:string,extra:Record<string,unknown>={}) {
  const requestId=crypto.randomUUID();
  const assertion=await new SignJWT({email:'kiran@atlas.example',email_verified:true,org_id:policy.organizationId,request_id:requestId}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(identity.issuer).setAudience(identity.audience).setSubject('smoke-user').setIssuedAt().setExpirationTime('60s').setJti(crypto.randomUUID()).sign(privateKey);
  const body={protocolVersion:GATEWAY_PROTOCOL_VERSION,requestId,connectorId:policy.connectorId,identity:{organizationId:policy.organizationId,assertion},...extra};
  const init={method:'POST',headers:{Authorization:'Bearer ephemeral-smoke-service-token-123456','Content-Type':'application/json'},body:JSON.stringify(body)};
  return {response:await fetch(endpoint+path,init),init};
}
try {
  const discovery=await send('/v1/catalog/discover');assert.equal(discovery.response.status,200);
  const catalog=await discovery.response.json() as {entities:unknown[]};assert.ok(catalog.entities.length);
  const plan=createWorkspaceQueryPlan(planWorkspaceRequest('Show pending endorsements grouped by type'));
  const run=await send('/v1/query-plans/execute',{plan});assert.equal(run.response.status,200);
  const result=await run.response.json() as {rows:Record<string,unknown>[];maskedFields:string[]};assert.ok(result.rows.length>0);assert.ok(result.maskedFields.includes('customer_name'));
  const replay=await fetch(endpoint+'/v1/query-plans/execute',run.init);assert.equal(replay.status,403);
  console.log('Real PostgreSQL reader, signed Gateway HTTP execution, masking and replay checks passed.');
} finally {server.close();await db.close();}
