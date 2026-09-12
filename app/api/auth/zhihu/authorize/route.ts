import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appId = process.env.ZHIHU_APP_ID;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI || `${url.origin}/api/auth/zhihu/callback`;
  if (!appId) return NextResponse.json({ error: "知乎 OAuth 尚未配置 ZHIHU_APP_ID" }, { status: 503 });
  const target = new URL("https://openapi.zhihu.com/authorize");
  target.searchParams.set("app_id", appId);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("redirect_uri", redirectUri);
  return NextResponse.redirect(target);
}
