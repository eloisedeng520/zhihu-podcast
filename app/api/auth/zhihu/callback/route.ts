import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("authorization_code") || url.searchParams.get("code");
  const appId = process.env.ZHIHU_APP_ID;
  const appKey = process.env.ZHIHU_APP_KEY;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI || `${url.origin}/api/auth/zhihu/callback`;
  if (!code || !appId || !appKey) return NextResponse.json({ error: "知乎授权参数不完整" }, { status: 400 });
  const body = new URLSearchParams({ app_id: appId, app_key: appKey, grant_type: "authorization_code", redirect_uri: redirectUri, code });
  const response = await fetch("https://openapi.zhihu.com/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return NextResponse.json({ error: "知乎授权失败", detail: data }, { status: 502 });
  const result = NextResponse.redirect(new URL("/", url));
  result.cookies.set("zhihu_access_token", data.access_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: Number(data.expires_in) || 3600, path: "/" });
  return result;
}
