import type { Answer, Outline, Segment } from "../lib/podcast.ts";

export class PublicError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function parseAnswerId(input: string): string {
  if (typeof input !== "string" || input.length > 600) throw new PublicError("请粘贴知乎回答链接或回答 ID。");
  const text = input.trim();
  if (/^\d{1,24}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !["www.zhihu.com", "zhihu.com", "m.zhihu.com"].includes(url.hostname) || url.username || url.password) throw 0;
    const match = url.pathname.match(/^(?:\/question\/\d+)?\/answer\/(\d{1,24})\/?$/);
    if (match) return match[1];
  } catch { /* Fall through to a user-facing message. */ }
  throw new PublicError("需要具体回答的链接（包含 /answer/），暂不支持问题页或短链接。");
}
export function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((obj, key) => obj !== null && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined, value);
}
export function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<img\b[^>]*>/gi, "\n[原文含图片]\n").replace(/<\/(?:p|div|li|h[1-6]|blockquote)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, m => ({"&nbsp;":" ","&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"})[m] || m)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {const cp = n[0].toLowerCase() === "x" ? parseInt(n.slice(1),16) : Number(n); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";})
    .replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function normalizeAnswer(raw: unknown, id: string, mapping: Record<string, string>): Answer {
  const field = (key: string) => getPath(raw, mapping[key] || key);
  const rawContent = field("content");
  if (typeof rawContent !== "string") throw new PublicError("知乎接口未返回正文，请检查接口字段映射。", 502);
  const content = plainText(rawContent);
  if (content.replace(/\[原文含图片\]/g, "").length < 180) throw new PublicError("这篇回答的可读文字较少，暂不适合制作对谈。请换一篇文字更丰富的回答。");
  if (content.length > 30000) throw new PublicError("这篇回答超过当前单篇 30,000 字限制，请选择较短的回答；系统不会截断原文生成。");
  const title = field("title"); const author = field("author");
  if (typeof title !== "string" || !title.trim() || typeof author !== "string" || !author.trim()) throw new PublicError("知乎接口缺少问题标题或作者，请检查字段映射。", 502);
  const lines = content.split(/\n+/).flatMap(line => line.match(/[\s\S]{1,800}/g) || []);
  return {id, title: plainText(title).slice(0,200), author: plainText(author).slice(0,100), url:`https://www.zhihu.com/answer/${id}`, paragraphs: lines.map((text,i)=>({id:`p${i+1}`,text})), fetchedAt:new Date().toISOString()};
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicError("AI 返回格式异常，请重试。", 502);
  return value as Record<string, unknown>;
}
function str(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new PublicError("AI 文本长度或格式不符合节目要求，请重试。", 502);
  return value.trim();
}
function refs(value: unknown, validIds: Set<string>, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some(id=>typeof id !== "string" || !validIds.has(id))) throw new PublicError("脚本存在缺失或无效的原文引用，已停止合成。请重试。", 422);
  return [...new Set(value as string[])];
}
export function validateOutline(value: unknown, source: Answer): Outline {
  const obj = record(value); const validIds = new Set(source.paragraphs.map(p=>p.id));
  if (!Array.isArray(obj.themes) || obj.themes.length < 1 || obj.themes.length > 5 || !Array.isArray(obj.limitations)) throw new PublicError("观点结构不完整，请重试。", 502);
  return {thesis:str(obj.thesis),themes:obj.themes.map(v=>{const t=record(v);return {title:str(t.title,60),summary:str(t.summary,500),sourceIds:refs(t.sourceIds,validIds)};}),limitations:obj.limitations.map(v=>str(v,300)).slice(0,6)};
}
export function validateScript(value: unknown, source: Answer): { title: string; segments: Segment[] } {
  const obj = record(value); const validIds = new Set(source.paragraphs.map(p=>p.id));
  if (!Array.isArray(obj.segments) || obj.segments.length < 6 || obj.segments.length > 48) throw new PublicError("节目对话段数不符合要求，请重新编排。", 422);
  const segments = obj.segments.map((v,i)=>{
    const s = record(v);
    if (!["host","guest"].includes(String(s.speaker)) || !["quote","paraphrase","transition"].includes(String(s.kind))) throw new PublicError("脚本角色或引用类型错误。", 422);
    if (s.kind === "transition" && s.speaker !== "host") throw new PublicError("讲述人的发言必须有原文依据。", 422);
    const text=str(s.text,600); const sourceIds=refs(s.sourceIds,validIds,s.kind === "transition");
    const aliases=source.contributors?["顾言","苏禾","周岚","沈砚"]:["林舟"];
    const rawSpeakerName=typeof s.speakerName==="string"?str(s.speakerName,100):undefined;
    const aliasIndex=source.contributors?source.contributors.findIndex((_,i)=>aliases[i]===rawSpeakerName):-1;
    const speakerName=source.contributors?(aliasIndex>=0?aliases[aliasIndex]:rawSpeakerName):(s.speaker==="guest"?"林舟":undefined);
    let voiceIndex:number|undefined;
    if(source.contributors&&s.speaker==="guest"){
      const contributorIndex=aliasIndex>=0?aliasIndex:source.contributors.findIndex(contributor=>contributor.name===rawSpeakerName);
      if(contributorIndex<0)throw new PublicError("多观点脚本缺少有效的答主署名。",422);
      if(sourceIds.some(id=>!id.startsWith(`a${contributorIndex+1}p`)))throw new PublicError("答主观点引用了其他答主的原文。",422);
      voiceIndex=contributorIndex;
    }
    if (s.kind === "quote" && !sourceIds.some(id => source.paragraphs.find(p=>p.id===id)?.text.includes(text))) throw new PublicError("标记为直接引用的内容与原文不一致。",422);
    return {id:`s${i+1}`,speaker:s.speaker as Segment["speaker"],speakerName,voiceIndex,kind:s.kind as Segment["kind"],text,chapter:str(s.chapter,60),sourceIds};
  });
  if (!segments.some(s=>s.speaker === "host") || !segments.some(s=>s.speaker === "guest")) throw new PublicError("访谈需要主持人和讲述人两个角色。",422);
  if (segments.reduce((n,s)=>n+s.text.length,0)>5500) throw new PublicError("节目文字过长，请重新编排。",422);
  return {title:str(obj.title,100),segments};
}
export function validateReview(value: unknown, segments: Segment[]): { passed: boolean; issues: string[] } {
  const obj=record(value);
  if (!Array.isArray(obj.checks) || obj.checks.length!==segments.length) throw new PublicError("AI 核对结果未覆盖全部对话，请重试。",502);
  const ids=new Set<string>(); const issues: string[]=[];
  for (const value of obj.checks) {
    const c=record(value); const id=str(c.id,20);
    if (ids.has(id)||!segments.some(s=>s.id===id)||typeof c.supported!=="boolean") throw new PublicError("AI 核对结果格式不完整，请重试。",502);
    ids.add(id);
    if (!c.supported) issues.push(`${id}：${str(c.reason,250)}`);
  }
  return {passed:issues.length===0,issues};
}
export function wavInfo(bytes: Uint8Array) {
  if (bytes.length<44) throw new PublicError("语音服务返回了空音频。",502);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const name=(pos:number)=>String.fromCharCode(...bytes.subarray(pos,pos+4));
  if(name(0)!=="RIFF"||name(8)!=="WAVE") throw new PublicError("语音服务未返回 WAV 音频，请检查输出格式配置。",502);
  let channels=0, sampleRate=0, bits=0, format=0, data:Uint8Array|null=null;
  for(let p=12;p+8<=bytes.length;) {
    const len=view.getUint32(p+4,true); const end=p+8+len;
    if(end>bytes.length) throw new PublicError("语音音频不完整，请重试。",502);
    if(name(p)==="fmt " && len>=16) {format=view.getUint16(p+8,true);channels=view.getUint16(p+10,true);sampleRate=view.getUint32(p+12,true);bits=view.getUint16(p+22,true);}
    if(name(p)==="data") data=bytes.subarray(p+8,end);
    p=end+(len%2);
  }
  if(format!==1||bits!==16||!channels||!sampleRate||!data?.length) throw new PublicError("当前仅支持 16 位 PCM WAV 音频。",502);
  return {channels,sampleRate,bits,data,duration:data.length/(sampleRate*channels*bits/8)};
}
export function joinWav(parts:Uint8Array[]):Uint8Array {
  const infos=parts.map(wavInfo); const first=infos[0];
  if (!first || infos.some(p=>p.channels!==first.channels||p.sampleRate!==first.sampleRate)) throw new PublicError("两位主播音频采样率不一致，暂时无法合并。",502);
  const size=infos.reduce((n,p)=>n+p.data.length,0);const out=new Uint8Array(44+size);const v=new DataView(out.buffer);
  const put=(s:string,p:number)=>out.set(new TextEncoder().encode(s),p);
  put("RIFF",0);v.setUint32(4,size+36,true);put("WAVEfmt ",8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,first.channels,true);v.setUint32(24,first.sampleRate,true);v.setUint32(28,first.sampleRate*first.channels*2,true);v.setUint16(32,first.channels*2,true);v.setUint16(34,16,true);put("data",36);v.setUint32(40,size,true);
  let pos=44;for(const p of infos){out.set(p.data,pos);pos+=p.data.length;}return out;
}
