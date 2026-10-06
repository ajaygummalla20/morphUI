import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import test, { type TestContext } from "node:test";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { SecurityError } from "../lib/server/security";
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

register("./helpers/cloudflare-env-loader.mjs", import.meta.url);
const { env } = await import("cloudflare:workers");
const { requireSession, guardRequest, SESSION_COOKIE } = await import("../lib/auth/session");
const { hashToken, rateLimit } = await import("../lib/auth/store");
const { POST: logout } = await import("../app/api/auth/logout/route");
const {GET:login}=await import('../app/api/auth/login/route');
const {GET:callback}=await import('../app/api/auth/callback/route');

const origin = "https://morph.example";
const issuer = "https://identity.example";
const token = "a".repeat(64);
const membership = {
  issuer, subject: "subject-member", organizationId: "org_one",
  organizationName: "Organization One", role: "member" as "admin" | "member" | "viewer",
};

function fixture(t: TestContext) {
  const database = createSqliteD1();
  const bindings = env as unknown as { DB?: typeof database.d1 };
  const previousDb = bindings.DB;
  bindings.DB = database.d1;
  const settings = {
    MORPH_AUTH_MODE: "oidc", MORPH_APP_ORIGIN: origin, MORPH_OIDC_ISSUER: issuer,
    MORPH_OIDC_AUTHORIZATION_URL: `${issuer}/authorize`, MORPH_OIDC_TOKEN_URL: `${issuer}/token`,
    MORPH_OIDC_JWKS_URL: `${issuer}/jwks`, MORPH_OIDC_CLIENT_ID: "test-client",
    MORPH_OIDC_CLIENT_SECRET: "test-only-client-secret",
    MORPH_AUTH_MEMBERSHIPS: JSON.stringify([membership]),
  };
  const previousSettings = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousDb === undefined) delete bindings.DB;
    else bindings.DB = previousDb;
    database.close();
  });
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    database.sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  database.sqlite.exec(`
    INSERT INTO organizations (id, slug, name) VALUES ('org_one', 'org-one', 'Organization One');
    INSERT INTO app_users (id, organization_id, email, full_name, role)
      VALUES ('user_one', 'org_one', 'member@example.test', 'Member', 'admin');
  `);
  return database;
}

async function seedSession(database: ReturnType<typeof createSqliteD1>, value = token, expiresAt = Math.floor(Date.now() / 1000) + 600) {
  database.sqlite.prepare(`INSERT INTO auth_sessions
    (token_hash, user_id, issuer, subject, organization_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(await hashToken(value), "user_one", issuer, membership.subject, membership.organizationId, expiresAt);
}

function request(value: string | null = token, method = "GET", requestOrigin = origin) {
  const headers = new Headers();
  if (value) headers.set("Cookie", `${SESSION_COOKIE}=${value}`);
  if (method !== "GET") headers.set("Origin", requestOrigin);
  return new Request(`${origin}/api/app-state`, { method, headers });
}

const denied = (status: number, code?: string) => (error: unknown) =>
  error instanceof SecurityError && error.status === status && (!code || error.code === code);

test("spoofed identity headers and missing or unknown sessions never authenticate", async (t) => {
  fixture(t);
  const spoofed = request(null);
  spoofed.headers.set("oai-authenticated-user-email", "admin@example.test");
  spoofed.headers.set("oai-authenticated-user-id", "user_one");
  spoofed.headers.set("x-morph-client-identity-assertion", "forged-assertion");
  await assert.rejects(requireSession(spoofed), denied(401, "sign_in_required"));
  await assert.rejects(requireSession(request()), denied(401, "session_expired"));
  await assert.rejects(requireSession(request("invalid-cookie")), denied(401, "sign_in_required"));
  process.env.MORPH_AUTH_MODE = "";
  await assert.rejects(requireSession(spoofed), denied(503, "auth_configuration"));
});

test("session lookup requires the token digest and rejects expired hashed sessions", async (t) => {
  const database = fixture(t);
  await seedSession(database);
  assert.equal((await requireSession(request())).id, "user_one");
  const stored = database.sqlite.prepare("SELECT token_hash FROM auth_sessions").get()?.token_hash;
  assert.equal(stored, await hashToken(token));
  assert.notEqual(stored, token);
  await assert.rejects(requireSession(request(String(stored))), denied(401, "session_expired"));

  database.sqlite.prepare("UPDATE auth_sessions SET expires_at = ?").run(Math.floor(Date.now() / 1000) - 1);
  await assert.rejects(requireSession(request()), denied(401, "session_expired"));
});

test("removing or moving server-side membership revokes an existing session", async (t) => {
  const database = fixture(t);
  await seedSession(database);
  assert.equal((await requireSession(request())).organizationId, "org_one");
  process.env.MORPH_AUTH_MEMBERSHIPS = "[]";
  await assert.rejects(requireSession(request()), denied(401, "session_revoked"));
  process.env.MORPH_AUTH_MEMBERSHIPS = JSON.stringify([{ ...membership, organizationId: "org_two" }]);
  await assert.rejects(requireSession(request()), denied(401, "session_revoked"));
});

test("role changes take effect on the next request regardless of stored user role", async (t) => {
  const database = fixture(t);
  await seedSession(database);
  assert.equal((await requireSession(request(), "member")).role, "member");
  await assert.rejects(requireSession(request(), "admin"), denied(403, "access_denied"));
  process.env.MORPH_AUTH_MEMBERSHIPS = JSON.stringify([{ ...membership, role: "viewer" }]);
  assert.equal((await requireSession(request(), "viewer")).role, "viewer");
  await assert.rejects(requireSession(request(), "member"), denied(403, "access_denied"));
  await assert.rejects(requireSession(request(), "admin"), denied(403, "access_denied"));
  database.sqlite.exec("DELETE FROM app_users WHERE id = 'user_one'");
  await assert.rejects(requireSession(request()), denied(401));
});

test("D1 enforces one shared request budget across concurrent calls and isolates budget keys", async (t) => {
  const database = fixture(t);
  t.mock.method(Date, "now", () => 1_800_000_010_000);
  const db = database.d1 as unknown as D1Database;
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => rateLimit(db, "org_one:user_one:generate", 3)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  for (const result of results) {
    if (result.status === "rejected") assert.ok(denied(429, "rate_limited")(result.reason));
  }
  assert.equal(database.sqlite.prepare("SELECT hits FROM request_limits").get()?.hits, 12);
  await rateLimit(db, "org_two:user_two:generate", 3);
  t.mock.method(Date, "now", () => 1_800_000_070_000);
  await rateLimit(db, "org_one:user_one:generate", 3);
});

test("request guard authenticates and authorizes before consuming the shared budget", async (t) => {
  const database = fixture(t);
  await seedSession(database);
  await assert.rejects(guardRequest(request(null), "generate", "member", 1), denied(401));
  await assert.rejects(guardRequest(request(), "admin-action", "admin", 1), denied(403));
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM request_limits").get()?.count, 0);
  await guardRequest(request(), "generate", "member", 1);
  await assert.rejects(guardRequest(request(), "generate", "member", 1), denied(429));
});

test("logout rejects cross-origin requests, invalidates its session and preserves other sessions", async (t) => {
  const database = fixture(t);
  const otherToken = "b".repeat(64);
  await seedSession(database);
  await seedSession(database, otherToken);

  const foreign = await logout(request(token, "POST", "https://evil.example"));
  assert.equal(foreign.status, 403);
  assert.equal((await requireSession(request())).id, "user_one");
  const response = await logout(request(token, "POST"));
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  assert.match(response.headers.get("Set-Cookie") ?? "", /Secure; HttpOnly; SameSite=Lax/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  await assert.rejects(requireSession(request()), denied(401, "session_expired"));
  assert.equal((await requireSession(request(otherToken))).id, "user_one");
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM auth_sessions").get()?.count, 1);
});

test('OIDC login binds browser state, exchanges PKCE and consumes callbacks once',async(t)=>{
  const database=fixture(t);
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'login-test'};
  const initial=await login();assert.equal(initial.status,302);
  const authorization=new URL(initial.headers.get('Location')!);
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorization.searchParams.get('redirect_uri'),`${origin}/api/auth/callback`);
  const state=authorization.searchParams.get('state')!,nonce=authorization.searchParams.get('nonce')!;
  const bindingCookie=initial.headers.get('Set-Cookie')!.split(';')[0];
  const flow=database.sqlite.prepare('SELECT verifier FROM auth_flows').get()!;
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(flow.verifier)))).toString('base64url');
  assert.equal(authorization.searchParams.get('code_challenge'),challenge);
  const idToken=await new SignJWT({email:'login@example.test',email_verified:true,name:'Login Member',nonce})
    .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('test-client').setSubject(membership.subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let exchanges=0;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const destination=String(input);
    if(destination===`${issuer}/jwks`) return Response.json({keys:[jwk]});
    assert.equal(destination,`${issuer}/token`);exchanges++;
    const form=new URLSearchParams(String(init?.body));
    assert.equal(form.get('code_verifier'),flow.verifier);assert.equal(form.get('grant_type'),'authorization_code');
    return Response.json({id_token:idToken});
  });
  const callbackUrl=`${origin}/api/auth/callback?state=${state}&code=test-code`;
  const foreign=await callback(new Request(callbackUrl,{headers:{Cookie:'__Host-morph-login='+ 'b'.repeat(64)}}));
  assert.equal(foreign.status,401);assert.equal(exchanges,0);
  const result=await callback(new Request(callbackUrl,{headers:{Cookie:bindingCookie}}));
  assert.equal(result.status,303);assert.equal(result.headers.get('Location'),origin);
  assert.equal(exchanges,1);
  assert.equal(database.sqlite.prepare('SELECT count(*) AS count FROM auth_flows').get()?.count,0);
  const sessionCookie=result.headers.getSetCookie().find(value=>value.startsWith(SESSION_COOKIE+'='))!;
  const sessionToken=sessionCookie.split(';')[0].split('=')[1];
  const signedIn=await requireSession(new Request(origin+'/api/app-state',{headers:{Cookie:sessionCookie.split(';')[0]}}));
  assert.equal(signedIn.role,'member');assert.equal(signedIn.organizationId,membership.organizationId);
  assert.equal(database.sqlite.prepare('SELECT token_hash FROM auth_sessions').get()?.token_hash,await hashToken(sessionToken));
  assert.ok(!JSON.stringify(database.sqlite.prepare('SELECT * FROM auth_sessions').all()).includes(idToken));
  const replay=await callback(new Request(callbackUrl,{headers:{Cookie:bindingCookie}}));
  assert.equal(replay.status,401);assert.equal(exchanges,1);
});
