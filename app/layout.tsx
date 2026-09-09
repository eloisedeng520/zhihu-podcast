import type {Metadata,Viewport} from "next";
import {headers} from "next/headers";
import "./globals.css";
export async function generateMetadata():Promise<Metadata>{
  const h=await headers();const host=h.get("host")||"localhost:3000";const origin=`${host.startsWith("localhost")?"http":"https"}://${host}`;
  return {title:"听见 · 把好回答听成一场对谈",description:"从知乎的一篇优质内容出发，生成有原文依据的双人 AI 播客。",appleWebApp:{capable:true,statusBarStyle:"default",title:"听见"},openGraph:{title:"听见 · 把好回答听成一场对谈",description:"知乎优质内容 · AI 双人播客",images:[`${origin}/og.png`],locale:"zh_CN",type:"website"},twitter:{card:"summary_large_image",images:[`${origin}/og.png`]}};
}
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#fcfaf6"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
