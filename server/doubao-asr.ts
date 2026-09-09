import {PublicError} from "./core.ts";

export type SpeechRecognitionEnv={ASR_PROVIDER?:string;DOUBAO_ASR_API_KEY?:string;DOUBAO_API_KEY?:string;DOUBAO_ASR_RESOURCE_ID?:string};
type DoubaoAsrResponse={result?:{text?:unknown}|Array<{text?:unknown}>;text?:unknown};
const speechKey=(env:SpeechRecognitionEnv)=>env.DOUBAO_ASR_API_KEY?.trim()||env.DOUBAO_API_KEY?.trim()||"";
export function speechRecognitionReady(env:SpeechRecognitionEnv){return (!env.ASR_PROVIDER||env.ASR_PROVIDER==="doubao")&&!!speechKey(env);}
const base64=(bytes:Uint8Array)=>{let result="";for(let i=0;i<bytes.length;i+=0x8000)result+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(result);};
export async function transcribeQuestion(env:SpeechRecognitionEnv,audio:Uint8Array):Promise<string>{
  if(!speechRecognitionReady(env))throw new PublicError("语音识别服务尚未配置。",503);
  try{
    const accessKey=speechKey(env);
    const response=await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",{method:"POST",redirect:"manual",signal:AbortSignal.timeout(90000),headers:{"Content-Type":"application/json","X-Api-Key":accessKey,"X-Api-Access-Key":accessKey,"X-Api-Resource-Id":env.DOUBAO_ASR_RESOURCE_ID?.trim()||"volc.bigasr.auc_turbo","X-Api-Request-Id":crypto.randomUUID()},body:JSON.stringify({user:{uid:"tingjian"},audio:{format:"wav",data:base64(audio)},request:{model_name:"bigmodel"}})});
    if(!response.ok)throw new PublicError(response.status===401||response.status===403?"语音识别鉴权失败，请检查服务端配置。":`语音识别暂时失败（${response.status}），请重新录制。`,502);
    const data=await response.json() as DoubaoAsrResponse;
    const text=Array.isArray(data.result)?data.result[0]?.text:data.result?.text??data.text;
    if(typeof text!=="string"||!text.trim())throw new PublicError("没有识别到有效问题，请靠近麦克风重新录制。",422);
    const cleaned=text.trim();if([...cleaned].length>300)throw new PublicError("识别到的问题过长，请简短提问。",422);return cleaned;
  }catch(error){if(error instanceof PublicError)throw error;throw new PublicError("语音识别请求超时或网络不可用，请重新录制。",502);}
}
