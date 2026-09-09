import {PublicError} from './core.ts';
import type {Segment} from '../lib/podcast.ts';
export type DoubaoEnv={DOUBAO_API_KEY?:string;DOUBAO_RESOURCE_ID?:string;DOUBAO_HOST_VOICE?:string;DOUBAO_GUEST_VOICE?:string};
export function doubaoReady(env:DoubaoEnv):boolean {
  return !!(env.DOUBAO_API_KEY?.trim()&&env.DOUBAO_RESOURCE_ID?.trim()&&env.DOUBAO_HOST_VOICE?.trim()&&env.DOUBAO_GUEST_VOICE?.trim()&&env.DOUBAO_HOST_VOICE.trim()!==env.DOUBAO_GUEST_VOICE.trim());
}
function pcmWave(parts:Uint8Array[],size:number):Uint8Array {
  if(!size||size%2)throw new PublicError('豆包返回的 PCM 音频为空或不完整。',502);
  const result=new Uint8Array(44+size),v=new DataView(result.buffer),e=new TextEncoder();
  result.set(e.encode('RIFF'),0);v.setUint32(4,36+size,true);result.set(e.encode('WAVEfmt '),8);
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  result.set(e.encode('data'),36);v.setUint32(40,size,true);let offset=44;
  for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export async function synthesizeDoubao(env:DoubaoEnv,segment:Segment):Promise<Uint8Array> {
  if(!doubaoReady(env))throw new PublicError('豆包语音尚未配置，请填写 API Key、资源 ID 和两个不同的音色 ID。',503);
  if(!segment.text.trim()||segment.text.length>600)throw new PublicError('待朗读文字为空或超过单段长度限制。',422);
  try {
    const response=await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),
      headers:{'Content-Type':'application/json','X-Api-Key':env.DOUBAO_API_KEY!.trim(),'X-Api-Resource-Id':env.DOUBAO_RESOURCE_ID!.trim(),'X-Api-Request-Id':crypto.randomUUID()},
      body:JSON.stringify({user:{uid:'tingjian'},req_params:{text:segment.text,speaker:(segment.speaker==='host'?env.DOUBAO_HOST_VOICE:env.DOUBAO_GUEST_VOICE)!.trim(),sample_rate:24000,audio_params:{format:'pcm',sample_rate:24000}}}),
    });
    if(!response.ok)throw new PublicError(response.status===401||response.status===403?'豆包语音鉴权或权限校验失败，请检查语音 API Key 和服务开通状态。':`豆包语音请求失败（HTTP ${response.status}）。`,502);
    if(!response.body)throw new PublicError('豆包未返回音频流。',502);
    const reader=response.body.getReader(),decoder=new TextDecoder(),parts:Uint8Array[]=[];
    let buffer='',size=0,total=0,finished=false;
    const parse=(line:string)=>{
      if(!line.startsWith('data:'))return;
      const event=JSON.parse(line.slice(5).trim());
      if(!event||typeof event!=='object'||![0,20000000].includes(event.code))throw new PublicError(`豆包语音合成失败${Number.isInteger(event?.code)?`（${event.code}）`:''}，请检查服务额度、资源 ID 和音色权限。`,502);
      if(event.data){
        if(finished||typeof event.data!=='string')throw new PublicError('豆包音频流格式异常。',502);
        const bytes=Uint8Array.from(atob(event.data),c=>c.charCodeAt(0));size+=bytes.length;
        if(size>12_000_000)throw new PublicError('单段音频过大。',502);parts.push(bytes);
      }
      if(event.code===20000000)finished=true;
    };
    try {
      while(true){
        const {done,value}=await reader.read();if(done)break;
        total+=value.byteLength;if(total>18_000_000)throw new PublicError('豆包音频流过大。',502);
        buffer+=decoder.decode(value,{stream:true});let end;
        while((end=buffer.indexOf('\n'))!==-1){parse(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}
      }
      buffer+=decoder.decode();if(buffer.trim())parse(buffer.trim());
      if(!finished)throw new PublicError('豆包音频流提前结束，请重试当前片段。',502);
      return pcmWave(parts,size);
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }catch(error){
    if(error instanceof PublicError)throw error;
    throw new PublicError('豆包语音请求超时、网络不可用或音频流格式异常，请重试当前片段。',502);
  }
}
