import {PublicError,joinWav,wavInfo} from './core.ts';
import type {Segment} from '../lib/podcast.ts';

export type TencentEnv = {
  TENCENT_SECRET_ID?:string; TENCENT_SECRET_KEY?:string; TENCENT_SESSION_TOKEN?:string;
  TTS_HOST_VOICE?:string; TTS_GUEST_VOICE?:string; TTS_GUEST_VOICES?:string;
};
const host='tts.tencentcloudapi.com';
const encoder=new TextEncoder();
const numericVoice=(value?:string)=>!!value&&/^\d{1,9}$/.test(value)&&Number(value)>0;
export function tencentReady(env:TencentEnv):boolean {
  const guests=tencentGuestVoices(env);return !!(env.TENCENT_SECRET_ID?.trim()&&env.TENCENT_SECRET_KEY?.trim()&&numericVoice(env.TTS_HOST_VOICE)&&guests.length&&guests.every(voice=>numericVoice(voice)&&voice!==env.TTS_HOST_VOICE));
}
export const tencentGuestVoices=(env:TencentEnv)=>[...new Set((env.TTS_GUEST_VOICES||env.TTS_GUEST_VOICE||"").split(",").map(v=>v.trim()).filter(Boolean))];
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
async function hmac(key:string|ArrayBuffer,value:string):Promise<ArrayBuffer> {
  const imported=await crypto.subtle.importKey('raw',typeof key==='string'?encoder.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return crypto.subtle.sign('HMAC',imported,encoder.encode(value));
}
async function headersFor(env:TencentEnv,body:string):Promise<Record<string,string>> {
  const timestamp=Math.floor(Date.now()/1000),date=new Date(timestamp*1000).toISOString().slice(0,10),scope=`${date}/tts/tc3_request`;
  const canonical=`POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${await hash(body)}`;
  const signingKey=await hmac(await hmac(await hmac('TC3'+env.TENCENT_SECRET_KEY!.trim(),date),'tts'),'tc3_request');
  const signature=hex(await hmac(signingKey,`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await hash(canonical)}`));
  return {
    'Content-Type':'application/json; charset=utf-8',
    'X-TC-Action':'TextToVoice','X-TC-Version':'2019-08-23','X-TC-Timestamp':String(timestamp),
    Authorization:`TC3-HMAC-SHA256 Credential=${env.TENCENT_SECRET_ID!.trim()}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    ...(env.TENCENT_SESSION_TOKEN?.trim()?{'X-TC-Token':env.TENCENT_SESSION_TOKEN.trim()}:{}),
  };
}
// Stay below the documented 150 Chinese / 500 English character limits.
// Preserve every character and prefer sentence boundaries; never split a surrogate pair.
function splitText(text:string):string[] {
  const chars=Array.from(text),parts:string[]=[];let start=0;
  while(start<chars.length){
    let end=start,bytes=0;
    while(end<chars.length&&end-start<140&&bytes+encoder.encode(chars[end]).length<=420){bytes+=encoder.encode(chars[end]).length;end++;}
    if(end<chars.length){for(let p=end-1;p>start;p--){if(/[。！？；.!?;\n]/u.test(chars[p])){end=p+1;break;}}}
    parts.push(chars.slice(start,end).join(''));start=end;
  }
  return parts;
}
function serviceError(code:unknown):PublicError {
  const value=typeof code==='string'?code:'';
  if(value==='UnsupportedOperation.PkgExhausted')return new PublicError('腾讯云语音资源包余量已用尽，请在语音合成控制台检查当前音色对应的资源包和计费设置。',502);
  const message=/AuthFailure|UnauthorizedOperation/.test(value)?'腾讯云语音鉴权失败，请检查 SecretId、SecretKey 和 TTS 权限。':
    /LimitExceeded|RequestLimitExceeded/.test(value)?'腾讯云语音调用额度或频率受限，请稍后重试。':
    /ResourceInsufficient|FailedOperation.Arrears|FailedOperation.UnOpenError/.test(value)?'腾讯云语音服务未开通或余额不足，请检查控制台。':
    /InvalidParameter/.test(value)?'腾讯云语音参数不支持，请检查所选音色及账号权限。':'腾讯云语音合成失败，请检查服务开通状态后重试。';
  return new PublicError(message,502);
}
export async function synthesizeTencent(env:TencentEnv,segment:Segment):Promise<Uint8Array> {
  if(!tencentReady(env))throw new PublicError('腾讯云语音尚未配置，请填写 SecretId、SecretKey 和两个不同的数字音色 ID。',503);
  if(!segment.text.trim()||segment.text.length>600)throw new PublicError('待朗读文字为空或超过单段长度限制。',422);
  const guests=tencentGuestVoices(env),voice=Number(segment.speaker==='host'?env.TTS_HOST_VOICE:guests[(segment.voiceIndex||0)%guests.length]);
  const parts:Uint8Array[]=[];let total=0;
  const signal=AbortSignal.timeout(180000);
  for(const text of splitText(segment.text)){
    const body=JSON.stringify({Text:text,SessionId:crypto.randomUUID(),ModelType:1,VoiceType:voice,PrimaryLanguage:1,SampleRate:16000,Codec:'wav'});
    let data:{Response?:{Audio?:unknown;Error?:{Code?:unknown}}};
    try {
      const response=await fetch(`https://${host}/`,{method:'POST',headers:await headersFor(env,body),body,redirect:'manual',signal});
      if(!response.ok)throw new PublicError(`腾讯云语音请求失败（HTTP ${response.status}）。`,502);
      const raw=await response.text();
      if(raw.length>17_000_000)throw new PublicError('腾讯云返回的音频过大。',502);
      data=JSON.parse(raw);
    }catch(error){
      if(error instanceof PublicError)throw error;
      throw new PublicError('腾讯云语音请求超时、网络不可用或响应格式异常，请重试当前片段。',502);
    }
    if(data?.Response?.Error)throw serviceError(data.Response.Error.Code);
    const audio=data?.Response?.Audio;
    if(typeof audio!=='string'||!audio)throw new PublicError('腾讯云未返回音频。',502);
    let bytes:Uint8Array;
    try {bytes=Uint8Array.from(atob(audio),c=>c.charCodeAt(0));}catch{throw new PublicError('腾讯云音频编码异常。',502);}
    const info=wavInfo(bytes);
    if(info.sampleRate!==16000||info.channels!==1)throw new PublicError('腾讯云返回的音频采样率或声道不符合要求。',502);
    total+=bytes.length;if(total>12_000_000)throw new PublicError('单段音频过大，请调整脚本长度。',502);
    parts.push(bytes);
  }
  return joinWav(parts);
}
