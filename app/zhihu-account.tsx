"use client";
/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are supplied by Zhihu at runtime. */
import { useCallback, useEffect, useState } from "react";

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
export type Session = {
  configured: boolean;
  connected: boolean;
  expiresAt: number | null;
  profile: ZhihuProfile | null;
  profileError: "unavailable" | null;
  stateVerified: boolean | null;
};
const messages: Record<string, string> = {
  connected: "知乎已连接。",
  invalid_state: "无法校验这次授权，请重新连接。若仍失败，需要确认知乎回调是否回传 state。",
  cancelled: "你已取消知乎授权。",
  missing_code: "知乎未返回授权码，请重新连接。",
  not_configured: "知乎连接尚未配置，请联系应用维护者。",
  exchange_failed: "知乎授权未完成，请稍后重新连接。",
};
async function fetchSession(refreshProfile = false): Promise<Session> {
  const result = await fetch(`/api/auth/zhihu/session${refreshProfile ? "?refresh_profile=1" : ""}`, { cache: "no-store" });
  if (!result.ok) throw new Error("session unavailable");
  return result.json();
}
export function ZhihuAccount({onSessionChange}: {onSessionChange?: (session: Session | null) => void}) {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const updateSession = useCallback((value: Session | null) => { setSession(value); onSessionChange?.(value); }, [onSessionChange]);
  const refresh = useCallback(async () => {
    try {
      updateSession(await fetchSession());
    } catch { updateSession(null); setMessage("暂时无法读取知乎连接状态。"); }
  }, [updateSession]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("zhihu_auth");
    if (outcome) {
      url.searchParams.delete("zhihu_auth");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    let cancelled = false;
    void fetchSession().then(value => {
      if (cancelled) return;
      updateSession(value);
      if (outcome) setMessage(messages[outcome] || "知乎连接未完成，请重试。");
    }).catch(() => {
      if (!cancelled) { updateSession(null); setMessage("暂时无法读取知乎连接状态。"); }
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [refresh, updateSession]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    const timer = setTimeout(() => { updateSession(session ? { ...session, connected: false, expiresAt: null, profile: null, profileError: null, stateVerified: null } : null); setMessage("知乎连接已过期，请重新授权。"); }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, updateSession]);
  async function refreshProfile() {
    try { updateSession(await fetchSession(true)); setMessage(""); }
    catch { setMessage("账号资料仍然无法读取，请稍后重试。"); }
  }
  async function logout() {
    setBusy(true);
    try {
      const result = await fetch("/api/auth/zhihu/logout", { method: "POST" });
      if (!result.ok) throw new Error();
      updateSession(session ? { ...session, connected: false, expiresAt: null, profile: null, profileError: null, stateVerified: null } : null);
      setMessage("已退出知乎连接。");
    } catch { setMessage("退出失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="zhihu-account" aria-label="知乎账号连接">
    <div className="zhihu-account-row"><div className="zhihu-account-identity">
      {/* Zhihu controls the runtime avatar host, so the build cannot use a fixed Next image allowlist. */}
      {session?.profile?.avatarUrl&&<img src={session.profile.avatarUrl} alt="" referrerPolicy="no-referrer"/>}
      <span><strong>{session?.profile?.name|| (session?.connected ? "知乎账号已授权" : "使用知乎账号登录")}</strong>{session?.profile?.headline&&<small>{session.profile.headline}</small>}{session?.profile?.url&&<a className="zhihu-profile-link" href={session.profile.url} target="_blank" rel="noopener noreferrer">查看知乎主页 ↗</a>}</span>
    </div>
      {session?.connected ? <button className="text-button" disabled={busy} onClick={logout}>{busy ? "正在退出…" : "退出"}</button>
        : session?.configured ? <>
          {/* OAuth requires a document navigation to the server authorization endpoint. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="text-button" href="/api/auth/zhihu/authorize">连接知乎 ↗</a>
        </>
        : <button className="text-button" onClick={() => { if (session) setMessage("知乎连接尚未开放，请稍后再试。"); else void refresh(); }}>{session ? "待开放" : "刷新连接状态"}</button>}
    </div>
    {session?.connected&&session.profileError==="unavailable"&&<p className="zhihu-account-message">账号资料暂时无法读取。<button className="text-button" onClick={()=>void refreshProfile()}>重试</button></p>}
    {message && <p className="zhihu-account-message" role="status">{message}</p>}
  </section>;
}
