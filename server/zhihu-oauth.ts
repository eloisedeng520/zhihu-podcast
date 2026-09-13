import type { Database } from "./store.ts";

export type ZhihuOAuthEnv = {
  DB?: Database;
  ZHIHU_APP_ID?: string;
  ZHIHU_APP_KEY?: string;
  ZHIHU_OAUTH_APP_KEY?: string;
  ZHIHU_REDIRECT_URI?: string;
};
const base = "/api/auth/zhihu";
const pendingCookie = "tingjian_zhihu_pending";
const sessionCookie = "tingjian_zhihu_session";
const encoder = new TextEncoder();
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const keyValue = (env: ZhihuOAuthEnv) => env.ZHIHU_OAUTH_APP_KEY || env.ZHIHU_APP_KEY;
const cookieValue = (request: Request, name: string) => request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const validSecret = (value: string) => /^[a-f0-9]{64}$/.test(value);
function cookie(request: Request, name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
function redirect(request: Request, location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
function config(env: ZhihuOAuthEnv) {
  if (!env.ZHIHU_APP_ID?.trim() || !keyValue(env)?.trim() || !env.ZHIHU_REDIRECT_URI || !env.DB) return null;
  try {
    const url = new URL(env.ZHIHU_REDIRECT_URI);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== `${base}/callback`) return null;
    return { appId: env.ZHIHU_APP_ID.trim(), appKey: keyValue(env)!, redirectUri: env.ZHIHU_REDIRECT_URI, origin: url.origin };
  } catch { return null; }
}
async function init(db: Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS zhihu_oauth_pending (browser_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS zhihu_oauth_sessions (id_hash TEXT PRIMARY KEY, encrypted_token TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  const now = Date.now();
  await db.prepare("DELETE FROM zhihu_oauth_pending WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM zhihu_oauth_sessions WHERE expires_at <= ?").bind(now).run();
}
async function tokenKey(env: ZhihuOAuthEnv) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`tingjian:zhihu:token:v1:${keyValue(env)}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(token: string, env: ZhihuOAuthEnv) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), encoder.encode(token));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
// Only server-side callers may read this value. Never include it in an API response.
export async function readZhihuToken(request: Request, env: ZhihuOAuthEnv): Promise<{ token: string; expiresAt: number } | null> {
  const id = cookieValue(request, sessionCookie);
  if (!validSecret(id) || !config(env)) return null;
  await init(env.DB!);
  const row = await env.DB!.prepare("SELECT encrypted_token, expires_at FROM zhihu_oauth_sessions WHERE id_hash = ? AND expires_at > ?").bind(await hash(id), Date.now()).first<{ encrypted_token: string; expires_at: number }>();
  if (!row) return null;
  try {
    const bytes = Uint8Array.from(atob(row.encrypted_token), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12));
    return { token: new TextDecoder().decode(plain), expiresAt: row.expires_at };
  } catch {
    await env.DB!.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(await hash(id)).run();
    return null;
  }
}
export async function handleZhihuOAuth(request: Request, env: ZhihuOAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const cfg = config(env);
  const clearPending = cookie(request, pendingCookie, "", 0);
  const fail = (code: string) => redirect(request, `/?zhihu_auth=${code}`, [clearPending]);
  try {
    if (path === `${base}/session` && request.method === "GET") {
      const session = await readZhihuToken(request, env);
      return response({ configured: !!cfg, connected: !!session, expiresAt: session?.expiresAt ?? null });
    }
    if (path === `${base}/logout` && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "请求来源不匹配。" }, 403);
      if (env.DB) {
        await init(env.DB);
        const id = cookieValue(request, sessionCookie);
        if (validSecret(id)) await env.DB.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(await hash(id)).run();
        const pending = cookieValue(request, pendingCookie);
        if (validSecret(pending)) await env.DB.prepare("DELETE FROM zhihu_oauth_pending WHERE browser_hash = ?").bind(await hash(pending)).run();
      }
      const result = response({ connected: false });
      result.headers.append("Set-Cookie", cookie(request, sessionCookie, "", 0));
      result.headers.append("Set-Cookie", clearPending);
      result.headers.append("Set-Cookie", cookie(request, "zhihu_access_token", "", 0));
      return result;
    }
    if (![`${base}/authorize`, `${base}/callback`].includes(path)) return response({ error: "接口不存在。" }, 404);
    if (request.method !== "GET") return response({ error: "不支持此操作。" }, 405);
    if (!cfg) return path.endsWith("/callback") ? fail("not_configured") : response({ error: "知乎连接尚未配置，请设置 App ID、App Key 和登记的回调地址。" }, 503);
    if (url.origin !== cfg.origin) {
      // Start on the registered origin so the browser-bound cookie is available
      // when Zhihu returns. Never forward callback codes or incoming query data.
      if (path === `${base}/authorize`) return redirect(request, `${cfg.origin}${base}/authorize`);
      return response({ error: "授权回调地址不匹配，请从登记的网站重新连接知乎。" }, 400);
    }
    await init(env.DB!);
    if (path.endsWith("/authorize")) {
      const state = random(), browser = random();
      const previous = cookieValue(request, pendingCookie);
      if (validSecret(previous)) await env.DB!.prepare("DELETE FROM zhihu_oauth_pending WHERE browser_hash = ?").bind(await hash(previous)).run();
      await env.DB!.prepare("INSERT INTO zhihu_oauth_pending (browser_hash,state_hash,expires_at) VALUES (?,?,?)").bind(await hash(browser), await hash(state), Date.now() + 600_000).run();
      const target = new URL("https://openapi.zhihu.com/authorize");
      target.search = new URLSearchParams({ app_id: cfg.appId, redirect_uri: cfg.redirectUri, response_type: "code", state }).toString();
      return redirect(request, target.href, [cookie(request, pendingCookie, browser, 600)]);
    }
    const browser = cookieValue(request, pendingCookie), state = url.searchParams.get("state") || "";
    if (!validSecret(browser) || !validSecret(state)) return fail("invalid_state");
    // Atomically consume the browser-bound state before exchanging a one-time code.
    const pending = await env.DB!.prepare("DELETE FROM zhihu_oauth_pending WHERE browser_hash = ? AND state_hash = ? AND expires_at > ? RETURNING browser_hash").bind(await hash(browser), await hash(state), Date.now()).first();
    if (!pending) return fail("invalid_state");
    if (url.searchParams.has("error")) return fail("cancelled");
    const code = url.searchParams.get("authorization_code") || url.searchParams.get("code");
    if (!code || code.length > 4096) return fail("missing_code");
    const upstream = await fetch("https://openapi.zhihu.com/access_token", {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ app_id: cfg.appId, app_key: cfg.appKey, grant_type: "authorization_code", redirect_uri: cfg.redirectUri, code }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const data = await upstream.json() as { access_token?: unknown; expires_in?: unknown };
    const seconds = Number(data.expires_in);
    if (!upstream.ok || typeof data.access_token !== "string" || !data.access_token.trim() || data.access_token.length > 16384 || !Number.isFinite(seconds) || seconds < 1) return fail("exchange_failed");
    const lifetime = Math.min(Math.floor(seconds), 86400), id = random();
    await env.DB!.prepare("INSERT INTO zhihu_oauth_sessions (id_hash,encrypted_token,expires_at) VALUES (?,?,?)").bind(await hash(id), await seal(data.access_token, env), Date.now() + lifetime * 1000).run();
    const old = cookieValue(request, sessionCookie);
    if (validSecret(old)) await env.DB!.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(await hash(old)).run();
    return redirect(request, "/?zhihu_auth=connected", [clearPending, cookie(request, sessionCookie, id, lifetime), cookie(request, "zhihu_access_token", "", 0)]);
  } catch {
    // Provider errors can contain credentials or authorization codes. Never forward or log them.
    return path.endsWith("/callback") ? fail("exchange_failed") : response({ error: "知乎连接暂时不可用，请稍后重试。" }, 503);
  }
}
