import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../server/api.ts';
import { readZhihuToken } from '../server/zhihu-oauth.ts';
const origin = 'https://tingjian.test';
const base = `${origin}/api/auth/zhihu`;
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const DB = { prepare(sql) { let args = []; const s = { bind(...v) { args = v; return s; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return {results: sqlite.prepare(sql).all(...args)}; } }; return s; } };
  return { sqlite, env: { DB, ZHIHU_APP_ID: 'app-id', ZHIHU_OAUTH_APP_KEY: 'backend-only-secret', ZHIHU_REDIRECT_URI: `${base}/callback` } };
}
const cookie = (response, name) => response.headers.getSetCookie().find(v => v.startsWith(`${name}=`))?.split(';')[0];
async function start(env) {
  const r = await handleApi(new Request(`${base}/authorize`), env);
  assert.equal(r.status, 303);
  return { r, state: new URL(r.headers.get('location')).searchParams.get('state'), cookie: cookie(r, 'tingjian_zhihu_pending') };
}
const callback = (env, flow, extra = 'authorization_code=one-time-code') => handleApi(new Request(`${base}/callback?state=${flow.state}&${extra}`, { headers: { Cookie: flow.cookie } }), env);

test('OAuth routes run through Worker API without audio binding; validate configuration and method', async t => {
  assert.deepEqual(await (await handleApi(new Request(`${base}/session`), {})).json(), { configured: false, connected: false, expiresAt: null });
  assert.equal((await handleApi(new Request(`${base}/authorize`), {})).status, 503);
  const { env } = fixture(t);
  assert.equal((await handleApi(new Request(`${base}/authorize`, { method: 'POST' }), env)).status, 405);
  const canonical = await handleApi(new Request(`${base}/authorize?state=untrusted&return_to=https://evil.test`), { ...env, ZHIHU_REDIRECT_URI: 'https://other.test/api/auth/zhihu/callback' });
  assert.equal(canonical.status, 303);
  assert.equal(canonical.headers.get('location'), 'https://other.test/api/auth/zhihu/authorize');
  assert.equal(canonical.headers.get('set-cookie'), null);
  const wrongCallback = await handleApi(new Request(`${base}/callback?authorization_code=private-code`), { ...env, ZHIHU_REDIRECT_URI: 'https://other.test/api/auth/zhihu/callback' });
  assert.equal(wrongCallback.status, 400);
  assert.equal(wrongCallback.headers.get('location'), null);
  assert.equal(wrongCallback.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.ok(!(await wrongCallback.text()).includes('private-code'));
  assert.equal((await handleApi(new Request(`${base}/authorize`), { ...env, ZHIHU_REDIRECT_URI: 'http://public.test/api/auth/zhihu/callback' })).status, 503);
});

test('successful exchange uses documented form, encrypted storage, opaque cookie and single-use state', async t => {
  const { env, sqlite } = fixture(t);
  const flow = await start(env), target = new URL(flow.r.headers.get('location'));
  assert.equal(target.origin, 'https://openapi.zhihu.com');
  assert.equal(target.searchParams.get('redirect_uri'), env.ZHIHU_REDIRECT_URI);
  assert.equal(target.searchParams.get('response_type'), 'code');
  assert.match(flow.r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(url, 'https://openapi.zhihu.com/access_token');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.fromEntries(init.body), { app_id: 'app-id', app_key: 'backend-only-secret', grant_type: 'authorization_code', redirect_uri: `${base}/callback`, code: 'one-time-code' });
    return Response.json({ code: 20000, access_token: 'private-oauth-token', expires_in: 3600 });
  });
  const r = await callback(env, flow);
  assert.equal(r.headers.get('location'), '/?zhihu_auth=connected');
  const sessionCookie = cookie(r, 'tingjian_zhihu_session');
  assert.ok(sessionCookie);
  assert.ok(!JSON.stringify([...r.headers]).includes('private-oauth-token'));
  const row = sqlite.prepare('SELECT * FROM zhihu_oauth_sessions').get();
  assert.ok(!row.encrypted_token.includes('private-oauth-token'));
  assert.notEqual(row.id_hash, sessionCookie.split('=')[1]);
  const req = new Request(`${base}/session`, { headers: { Cookie: sessionCookie } });
  const session = await (await handleApi(req, env)).json();
  assert.equal(session.connected, true);
  assert.equal(session.configured, true);
  assert.ok(!JSON.stringify(session).includes('token'));
  assert.equal((await readZhihuToken(req, env)).token, 'private-oauth-token');
  assert.equal((await callback(env, flow)).headers.get('location'), '/?zhihu_auth=invalid_state');
  assert.equal(calls, 1);
  const cross = await handleApi(new Request(`${base}/logout`, { method: 'POST', headers: { Origin: 'https://evil.test', Cookie: sessionCookie } }), env);
  assert.equal(cross.status, 403);
  assert.equal((await (await handleApi(req, env)).json()).connected, true);
  const logout = await handleApi(new Request(`${base}/logout`, { method: 'POST', headers: { Origin: origin, Cookie: sessionCookie } }), env);
  assert.equal(logout.status, 200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM zhihu_oauth_sessions').get().n, 0);
  assert.equal((await (await handleApi(req, env)).json()).connected, false);
});

test('missing, incorrect, cross-browser and expired state never exchange a token', async t => {
  const { env, sqlite } = fixture(t);
  const flow = await start(env), other = await start(env);
  t.mock.method(globalThis, 'fetch', () => { assert.fail('must not call provider'); });
  for (const req of [
    new Request(`${base}/callback?authorization_code=secret`, { headers: { Cookie: flow.cookie } }),
    new Request(`${base}/callback?state=${'0'.repeat(64)}&code=secret`, { headers: { Cookie: flow.cookie } }),
    new Request(`${base}/callback?state=${flow.state}&code=secret`, { headers: { Cookie: other.cookie } }),
    new Request(`${base}/callback?state=${flow.state}&code=secret`),
  ]) assert.equal((await handleApi(req, env)).headers.get('location'), '/?zhihu_auth=invalid_state');
  sqlite.prepare('UPDATE zhihu_oauth_pending SET expires_at = 0').run();
  assert.equal((await callback(env, flow)).headers.get('location'), '/?zhihu_auth=invalid_state');
});

test('missing code, cancellation, provider failure and invalid expiry are sanitized', async t => {
  const { env } = fixture(t);
  assert.equal((await callback(env, await start(env), '')).headers.get('location'), '/?zhihu_auth=missing_code');
  assert.equal((await callback(env, await start(env), 'error=access_denied')).headers.get('location'), '/?zhihu_auth=cancelled');
  for (const payload of [{ error: 'sensitive-provider-debug', app_key: 'backend-only-secret' }, { access_token: 'sensitive-token', expires_in: -1 }, { access_token: 'sensitive-token' }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
    const r = await callback(env, await start(env));
    assert.equal(r.headers.get('location'), '/?zhihu_auth=exchange_failed');
    assert.equal(await r.text(), '');
    assert.ok(!JSON.stringify([...r.headers]).includes('sensitive'));
  }
});

test('code alias, legacy key, expiration and key rotation', async t => {
  const { env, sqlite } = fixture(t);
  env.ZHIHU_APP_KEY = env.ZHIHU_OAUTH_APP_KEY;
  delete env.ZHIHU_OAUTH_APP_KEY;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.body.get('code'), 'legacy-code');
    return Response.json({ access_token: 'token', expires_in: 100 });
  });
  let r = await callback(env, await start(env), 'code=legacy-code');
  let req = new Request(`${base}/session`, { headers: { Cookie: cookie(r, 'tingjian_zhihu_session') } });
  sqlite.prepare('UPDATE zhihu_oauth_sessions SET expires_at = 0').run();
  assert.equal((await (await handleApi(req, env)).json()).connected, false);
  r = await callback(env, await start(env), 'code=legacy-code');
  req = new Request(`${base}/session`, { headers: { Cookie: cookie(r, 'tingjian_zhihu_session') } });
  env.ZHIHU_APP_KEY = 'rotated';
  assert.equal((await (await handleApi(req, env)).json()).connected, false);
});


test('library lists are available without a Zhihu connection', async t => {
  const {env, sqlite} = fixture(t);
  env.AUDIO = {};
  const headers = {'X-Anonymous-Id': 'visitor-test-1234567890'};
  const paths = ['/api/episodes', '/api/library', '/api/library/questions'];
  async function verify(cookieValue, expected) {
    for (const path of paths) {
      const r = await handleApi(new Request(origin + path, {headers: {...headers, ...(cookieValue ? {Cookie:cookieValue} : {})}}), env);
      assert.equal(r.status, expected, path);
      const data = await r.json();
      if(expected===401) { assert.ok(data.error); assert.equal(data.episodes, undefined); assert.equal(data.items, undefined); assert.equal(data.questions, undefined); }
    }
  }
  await verify(null, 200);
  await verify('tingjian_zhihu_session='+'0'.repeat(64), 200);
  t.mock.method(globalThis, 'fetch', async () => Response.json({access_token:'private-token', expires_in:3600}));
  let r = await callback(env, await start(env));
  let session = cookie(r, 'tingjian_zhihu_session');
  await verify(session, 200);
  await handleApi(new Request(base+'/logout', {method:'POST',headers:{Origin:origin,Cookie:session}}),env);
  await verify(session, 200);
  r = await callback(env, await start(env));
  session = cookie(r, 'tingjian_zhihu_session');
  sqlite.prepare('UPDATE zhihu_oauth_sessions SET expires_at=0').run();
  await verify(session, 200);
});
