import type { Database } from "./store.ts";

export type ZhihuOAuthEnv = {
  DB?: Database;
  ZHIHU_APP_ID?: string;
  ZHIHU_APP_KEY?: string;
  ZHIHU_OAUTH_APP_KEY?: string;
  ZHIHU_REDIRECT_URI?: string;
};
export type ZhihuProfile = {
  uid: string | null;
  name: string | null;
  gender: string | null;
  avatarUrl: string | null;
  headline: string | null;
  description: string | null;
  phoneNumber: string | null;
  email: string | null;
  url: string | null;
};
const base = "/api/auth/zhihu";
const pendingCookie = "tingjian_zhihu_pending";
const sessionCookie = "tingjian_zhihu_session";
const profileEndpoint = "https://openapi.zhihu.com/user";
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
  await db.prepare("CREATE TABLE IF NOT EXISTS zhihu_oauth_session_info (id_hash TEXT PRIMARY KEY, state_verified INTEGER NOT NULL, profile_json TEXT, profile_error TEXT, updated_at INTEGER NOT NULL)").run();
  const now = Date.now();
  await db.prepare("DELETE FROM zhihu_oauth_pending WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM zhihu_oauth_sessions WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM zhihu_oauth_session_info WHERE id_hash NOT IN (SELECT id_hash FROM zhihu_oauth_sessions)").run();
}
type SessionInfo = { stateVerified: boolean; profile: ZhihuProfile | null; profileError: "unavailable" | null };
type SessionInfoRow = { state_verified: number; profile_json: string | null; profile_error: string | null };
const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
const objectValue = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uidValue = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : typeof value === "string" && /^\d{1,32}$/.test(value.trim()) ? value.trim() : null;
function safeHttpsUrl(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  try { const url = new URL(text); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
function normalizeProfile(payload: unknown): ZhihuProfile | null {
  const root = objectValue(payload);
  if (!root) return null;
  const source = objectValue(root.data) || objectValue(root.Data) || objectValue(root.user) || root;
  const profile: ZhihuProfile = {
    uid: uidValue(source.uid) || uidValue(source.Uid),
    name: stringValue(source.name) || stringValue(source.Fullname) || stringValue(source.fullname),
    gender: stringValue(source.gender) || stringValue(source.Gender),
    avatarUrl: safeHttpsUrl(source.avatar_path) || safeHttpsUrl(source.AvatarPath) || safeHttpsUrl(source.avatarUrl) || safeHttpsUrl(source.avatar_url) || safeHttpsUrl(source.AvatarUrl),
    headline: stringValue(source.headline) || stringValue(source.Headline),
    description: stringValue(source.description) || stringValue(source.Description),
    phoneNumber: stringValue(source.phoneNumber) || stringValue(source.phone_no) || stringValue(source.PhoneNo),
    email: stringValue(source.email) || stringValue(source.Email),
    url: safeHttpsUrl(source.url) || safeHttpsUrl(source.Url),
  };
  return Object.values(profile).some(Boolean) ? profile : null;
}
async function fetchProfile(token: string): Promise<Pick<SessionInfo, "profile" | "profileError">> {
  if (/[\r\n]/.test(token)) return { profile: null, profileError: "unavailable" };
  try {
    const upstream = await fetch(profileEndpoint, {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!upstream.ok) return { profile: null, profileError: "unavailable" };
    const payload = await upstream.json() as unknown;
    const root = objectValue(payload), code = root?.Code ?? root?.code;
    if (code !== undefined && Number(code) !== 0 && Number(code) !== 20000) return { profile: null, profileError: "unavailable" };
    const profile = normalizeProfile(payload);
    return profile ? { profile, profileError: null } : { profile: null, profileError: "unavailable" };
  } catch { return { profile: null, profileError: "unavailable" }; }
}
async function saveSessionInfo(db: Database, idHash: string, info: SessionInfo) {
  await db.prepare("INSERT INTO zhihu_oauth_session_info (id_hash,state_verified,profile_json,profile_error,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id_hash) DO UPDATE SET state_verified=excluded.state_verified,profile_json=excluded.profile_json,profile_error=excluded.profile_error,updated_at=excluded.updated_at")
    .bind(idHash, info.stateVerified ? 1 : 0, info.profile ? JSON.stringify(info.profile) : null, info.profileError, Date.now()).run();
}
async function readSessionInfo(db: Database, idHash: string): Promise<SessionInfo | null> {
  const row = await db.prepare("SELECT state_verified,profile_json,profile_error FROM zhihu_oauth_session_info WHERE id_hash = ?").bind(idHash).first<SessionInfoRow>();
  if (!row) return null;
  let profile: ZhihuProfile | null = null;
  try { profile = row.profile_json ? normalizeProfile(JSON.parse(row.profile_json)) : null; } catch { profile = null; }
  const profileError = row.profile_error ? "unavailable" : null;
  return { stateVerified: !!row.state_verified, profile, profileError };
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
export async function readZhihuToken(request: Request, env: ZhihuOAuthEnv): Promise<{ token: string; expiresAt: number; idHash: string } | null> {
  const id = cookieValue(request, sessionCookie);
  if (!validSecret(id) || !config(env)) return null;
  await init(env.DB!);
  const idHash = await hash(id);
  const row = await env.DB!.prepare("SELECT encrypted_token, expires_at FROM zhihu_oauth_sessions WHERE id_hash = ? AND expires_at > ?").bind(idHash, Date.now()).first<{ encrypted_token: string; expires_at: number }>();
  if (!row) return null;
  try {
    const bytes = Uint8Array.from(atob(row.encrypted_token), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12));
    return { token: new TextDecoder().decode(plain), expiresAt: row.expires_at, idHash };
  } catch {
    await env.DB!.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(idHash).run();
    await env.DB!.prepare("DELETE FROM zhihu_oauth_session_info WHERE id_hash = ?").bind(idHash).run();
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
      if (!session) return response({ configured: !!cfg, connected: false, expiresAt: null, profile: null, profileError: null, stateVerified: null });
      let info = await readSessionInfo(env.DB!, session.idHash);
      if (!info || url.searchParams.get("refresh_profile") === "1") {
        const profile = await fetchProfile(session.token);
        info = { stateVerified: info?.stateVerified ?? false, ...profile };
        await saveSessionInfo(env.DB!, session.idHash, info);
      }
      return response({ configured: !!cfg, connected: true, expiresAt: session.expiresAt, profile: info.profile, profileError: info.profileError, stateVerified: info.stateVerified });
    }
    if (path === `${base}/logout` && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "请求来源不匹配。" }, 403);
      if (env.DB) {
        await init(env.DB);
        const id = cookieValue(request, sessionCookie);
        if (validSecret(id)) {
          const idHash = await hash(id);
          await env.DB.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(idHash).run();
          await env.DB.prepare("DELETE FROM zhihu_oauth_session_info WHERE id_hash = ?").bind(idHash).run();
        }
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
    if (!validSecret(browser) || (state && !validSecret(state))) return fail("invalid_state");
    const browserHash = await hash(browser);
    // Some current Zhihu callbacks omit state. A returned state is still checked
    // strictly; without one, the single-use browser-bound pending record is the
    // documented hackathon fallback and the session is marked unverified.
    const pending = state
      ? await env.DB!.prepare("DELETE FROM zhihu_oauth_pending WHERE browser_hash = ? AND state_hash = ? AND expires_at > ? RETURNING browser_hash").bind(browserHash, await hash(state), Date.now()).first()
      : await env.DB!.prepare("DELETE FROM zhihu_oauth_pending WHERE browser_hash = ? AND expires_at > ? RETURNING browser_hash").bind(browserHash, Date.now()).first();
    if (!pending) return fail("invalid_state");
    if (url.searchParams.has("error")) return fail("cancelled");
    const code = url.searchParams.get("authorization_code") || url.searchParams.get("code");
    if (!code || code.length > 4096) return fail("missing_code");
    const upstream = await fetch("https://openapi.zhihu.com/access_token", {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ app_id: cfg.appId, app_key: cfg.appKey, grant_type: "authorization_code", redirect_uri: cfg.redirectUri, code }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const data = await upstream.json() as Record<string, unknown>;
    const nested = objectValue(data.data) || objectValue(data.Data);
    const tokenValue = data.access_token ?? nested?.access_token;
    const expiresValue = data.expires_in ?? nested?.expires_in;
    const seconds = Number(expiresValue);
    if (!upstream.ok || typeof tokenValue !== "string" || !tokenValue.trim() || tokenValue.length > 16384 || !Number.isFinite(seconds) || seconds < 1) return fail("exchange_failed");
    const accessToken = tokenValue.trim();
    const lifetime = Math.min(Math.floor(seconds), 86400), id = random();
    const idHash = await hash(id);
    await env.DB!.prepare("INSERT INTO zhihu_oauth_sessions (id_hash,encrypted_token,expires_at) VALUES (?,?,?)").bind(idHash, await seal(accessToken, env), Date.now() + lifetime * 1000).run();
    const profile = await fetchProfile(accessToken);
    await saveSessionInfo(env.DB!, idHash, { stateVerified: !!state, ...profile });
    const old = cookieValue(request, sessionCookie);
    if (validSecret(old)) {
      const oldHash = await hash(old);
      await env.DB!.prepare("DELETE FROM zhihu_oauth_sessions WHERE id_hash = ?").bind(oldHash).run();
      await env.DB!.prepare("DELETE FROM zhihu_oauth_session_info WHERE id_hash = ?").bind(oldHash).run();
    }
    return redirect(request, "/?zhihu_auth=connected", [clearPending, cookie(request, sessionCookie, id, lifetime), cookie(request, "zhihu_access_token", "", 0)]);
  } catch {
    // Provider errors can contain credentials or authorization codes. Never forward or log them.
    return path.endsWith("/callback") ? fail("exchange_failed") : response({ error: "知乎连接暂时不可用，请稍后重试。" }, 503);
  }
}
