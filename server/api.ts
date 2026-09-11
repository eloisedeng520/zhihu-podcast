import type { Episode } from "../lib/podcast.ts";
import { PublicError,validateOutline,validateScript,validateReview,wavInfo,joinWav } from "./core.ts";
import { type ProviderEnv,providerStatus,fetchKnowledge,fetchAnswer,analyze,write,review,synthesize,transcribeQuestion,answerQuestion } from "./providers.ts";
import { type Database,type AudioBucket,initDb,readEpisode,saveEpisode,readQuestion,listQuestions } from "./store.ts";
export type AppEnv = ProviderEnv & {DB:Database;AUDIO:AudioBucket};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const present=(e:Episode)=>({...e,segments:e.segments.map(({audioKey,...s})=>({...s,audioReady:!!audioKey}))});
const validId=(s:string)=>/^[A-Za-z0-9_-]{16,72}$/.test(s);
async function ownerKey(request:Request){const email=request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();const anonymous=request.headers.get("X-Anonymous-Id")?.trim();const identity=email&&email.length<=320?`user:${email}`:anonymous&&/^[A-Za-z0-9_-]{16,80}$/.test(anonymous)?`anon:${anonymous}`:null;if(!identity)throw new PublicError("请重新加载页面后再提问。",400);const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}

export async function advance(env:AppEnv,ep:Episode):Promise<Episode> {
  if(ep.stage==="fetching") {ep.source=await fetchAnswer(env,ep.answerId);ep.title=ep.source.title;ep.stage="analyzing";}
  else if(ep.stage==="analyzing") {ep.outline=validateOutline(await analyze(env,ep.source!),ep.source!);ep.stage="writing";}
  else if(ep.stage==="writing") {const result=validateScript(await write(env,ep.source!,ep.outline!,ep.minutes),ep.source!);ep.title=result.title;ep.segments=result.segments;ep.completedAudio=0;ep.review=undefined;ep.stage="reviewing";}
  else if(ep.stage==="reviewing") {ep.review=validateReview(await review(env,ep.source!,ep.segments),ep.segments);if(!ep.review.passed)throw new PublicError("有内容未通过原文核对，已暂停。重试将重新编排脚本。",422);ep.stage="synthesizing";}
  else if(ep.stage==="synthesizing") {
    if(!providerStatus(env).audioReady)return ep;
    if(!ep.review?.passed)throw new PublicError("节目尚未通过核对，无法合成。",422);
    const s=ep.segments.find(s=>!s.audioKey);
    if(s){const bytes=await synthesize(env,s);const {duration}=wavInfo(bytes);const key=`episodes/${ep.id}/${s.id}.wav`;await env.AUDIO.put(key,bytes,{httpMetadata:{contentType:"audio/wav"}});s.duration=duration;s.audioKey=key;ep.completedAudio=ep.segments.filter(s=>s.audioKey).length;}
    else {
      const parts:Uint8Array[]=[];let total=0;
      for(const segment of ep.segments){const part=await env.AUDIO.get(segment.audioKey!);if(!part)throw new PublicError("已保存的音频片段缺失，请联系维护者。",502);total+=part.size;if(total>40_000_000)throw new PublicError("整期音频超过当前大小限制。",422);parts.push(new Uint8Array(await part.arrayBuffer()));}
      const bytes=joinWav(parts);
      await env.AUDIO.put(`episodes/${ep.id}/full.wav`,bytes,{httpMetadata:{contentType:"audio/wav"}});ep.stage="ready";ep.status="ready";
    }
  }
  return ep;
}

export async function handleApi(request:Request,env:AppEnv):Promise<Response> {
  try {
    const url=new URL(request.url);const path=url.pathname;
    const isQuestionAudio=request.method==="POST"&&/^\/api\/episodes\/[A-Za-z0-9_-]{16,72}\/questions$/.test(path);
    if(request.method!=="GET" && request.method!=="HEAD"){
      const origin=request.headers.get("Origin");if(origin&&origin!==url.origin)throw new PublicError("请求来源不匹配。",403);
      if(request.headers.get("Sec-Fetch-Site")==="cross-site")throw new PublicError("不支持跨站操作。",403);
      const contentType=request.headers.get("Content-Type")||"";
      if(isQuestionAudio?!contentType.toLowerCase().startsWith("audio/wav"):!contentType.includes("application/json"))throw new PublicError(isQuestionAudio?"请上传 WAV 录音。":"请使用 JSON 请求。",415);
    }
    if(path==="/api/status" && request.method==="GET"){
      const p=providerStatus(env);const storage=!!(env.DB&&env.AUDIO);return json({ready:p.ready&&storage,textReady:p.textReady&&storage,audioReady:p.audioReady&&storage,services:[...p.services,{name:"节目存储",configured:storage,detail:"保留节目、脚本与音频"}]});
    }
    if(path==="/api/knowledge" && request.method==="GET")return json({items:await fetchKnowledge()});
    if(path.startsWith("/api/knowledge/") && request.method==="GET"){
      const id=path.slice("/api/knowledge/".length);if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw new PublicError("内容 ID 格式错误。");
      return json(await fetchAnswer(env,id));
    }
    if(!env.DB||!env.AUDIO)throw new PublicError("节目存储尚未就绪。",503);
    await initDb(env.DB);
    const episodeQuestions=path.match(/^\/api\/episodes\/([A-Za-z0-9_-]{16,72})\/questions$/);
    if(episodeQuestions){
      const episodeId=episodeQuestions[1],owner=await ownerKey(request),ep=await readEpisode(env.DB,episodeId);if(!ep)throw new PublicError("没有找到这期节目。",404);
      if(request.method==="GET")return json({questions:await listQuestions(env.DB,episodeId,owner)});
      if(request.method!=="POST")throw new PublicError("不支持此操作。",405);
      const id=request.headers.get("Idempotency-Key")||"";if(!validId(id))throw new PublicError("缺少有效的提问标识。");
      const existing=await readQuestion(env.DB,id,owner);if(existing)return json(existing);
      const pos=Number(request.headers.get("X-Playback-Position"));const duration=ep.segments.reduce((n,s)=>n+(s.duration||0),0);if(!Number.isFinite(pos)||pos<0||(duration&&pos>duration+5))throw new PublicError("播放位置无效。");
      const stats=await env.DB.prepare("SELECT SUM(CASE WHEN status IN ('transcribing','answering') THEN 1 ELSE 0 END) AS busy FROM episode_questions WHERE owner_key = ? AND episode_id = ?").bind(owner,episodeId).first<{busy:number}>();
      if((stats?.busy||0)>0)throw new PublicError("上一个问题仍在处理，请稍候。",409);
      const length=Number(request.headers.get("Content-Length"));if(Number.isFinite(length)&&length>1_100_000)throw new PublicError("录音超过 30 秒或文件过大。",413);
      const audio=new Uint8Array(await request.arrayBuffer());if(audio.length>1_100_000)throw new PublicError("录音超过 30 秒或文件过大。",413);const info=wavInfo(audio);if(info.channels!==1||info.sampleRate!==16000||info.duration<.25||info.duration>30.25)throw new PublicError("请上传 30 秒内的 16kHz 单声道 WAV 录音。",422);
      const now=new Date().toISOString();await env.DB.prepare("INSERT OR IGNORE INTO episode_questions (id,episode_id,owner_key,position_seconds,question_text,answer_text,source_ids,status,error_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,episodeId,owner,pos,"",null,"[]","transcribing",null,now,now).run();
      let question:string;try{question=await transcribeQuestion(env,audio);}catch(error){await env.DB.prepare("DELETE FROM episode_questions WHERE id = ? AND owner_key = ? AND status = 'transcribing'").bind(id,owner).run();throw error;}
      await env.DB.prepare("UPDATE episode_questions SET question_text = ?, status = 'answering', updated_at = ? WHERE id = ? AND owner_key = ?").bind(question,new Date().toISOString(),id,owner).run();
      try{const recent=await listQuestions(env.DB,episodeId,owner,4);const result=await answerQuestion(env,ep.source!,question,pos,recent.filter(q=>q.id!==id).slice(0,3));await env.DB.prepare("UPDATE episode_questions SET answer_text = ?, source_ids = ?, status = 'ready', error_code = NULL, updated_at = ? WHERE id = ? AND owner_key = ?").bind(result.answer,JSON.stringify(result.sourceIds),new Date().toISOString(),id,owner).run();}
      catch{await env.DB.prepare("UPDATE episode_questions SET status = 'failed', error_code = 'answer_failed', updated_at = ? WHERE id = ? AND owner_key = ?").bind(new Date().toISOString(),id,owner).run();}
      return json((await readQuestion(env.DB,id,owner))!,201);
    }
    const questionAction=path.match(/^\/api\/questions\/([A-Za-z0-9_-]{16,72})\/(audio|retry)$/);
    if(questionAction){
      if(request.method!=="POST")throw new PublicError("不支持此操作。",405);const owner=await ownerKey(request);const q=await readQuestion(env.DB,questionAction[1],owner);if(!q)throw new PublicError("没有找到这条提问。",404);
      if(questionAction[2]==="audio"){if(q.status!=="ready"||!q.answerText)throw new PublicError("回答尚未准备好。",409);const bytes=await synthesize(env,{id:`q-${q.id}`,speaker:"host",kind:"transition",chapter:"回答",text:q.answerText,sourceIds:q.sourceIds});const body=new Uint8Array(bytes);return new Response(body,{headers:{"Content-Type":"audio/wav","Cache-Control":"no-store","Content-Length":String(body.byteLength),"X-Content-Type-Options":"nosniff"}});}
      if(q.status!=="failed"||q.errorCode!=="answer_failed"||!q.questionText)throw new PublicError("这条提问不需要重试。",409);const ep=await readEpisode(env.DB,q.episodeId);if(!ep?.source)throw new PublicError("节目原文暂时不可用。",409);
      await env.DB.prepare("UPDATE episode_questions SET status = 'answering', error_code = NULL, updated_at = ? WHERE id = ? AND owner_key = ? AND status = 'failed'").bind(new Date().toISOString(),q.id,owner).run();try{const result=await answerQuestion(env,ep.source,q.questionText,q.positionSeconds,(await listQuestions(env.DB,q.episodeId,owner,4)).filter(x=>x.id!==q!.id).slice(0,3));await env.DB.prepare("UPDATE episode_questions SET answer_text = ?, source_ids = ?, status = 'ready', updated_at = ? WHERE id = ? AND owner_key = ?").bind(result.answer,JSON.stringify(result.sourceIds),new Date().toISOString(),q.id,owner).run();}catch(error){await env.DB.prepare("UPDATE episode_questions SET status = 'failed', error_code = 'answer_failed', updated_at = ? WHERE id = ? AND owner_key = ?").bind(new Date().toISOString(),q.id,owner).run();throw error;}return json((await readQuestion(env.DB,q.id,owner))!);
    }
    if(path==="/api/episodes" && request.method==="GET"){
      const rows=await env.DB.prepare("SELECT payload FROM episodes ORDER BY created_at DESC LIMIT 50").all<{payload:string}>();
      return json({episodes:rows.results.map(r=>JSON.parse(r.payload) as Episode).filter(e=>e.status!=="failed").map(e=>({id:e.id,title:e.title,minutes:e.minutes,stage:e.stage,status:e.status,createdAt:e.createdAt,author:e.source?.author,duration:e.segments.reduce((n,s)=>n+(s.duration||0),0)}))});
    }
    if(path==="/api/episodes" && request.method==="POST") {
      if(!providerStatus(env).textReady)throw new PublicError("AI 编导尚未配置，请先完成文本模型接入。知乎原文可以正常浏览。",503);
      const raw=await request.text();if(raw.length>1000)throw new PublicError("请求过大。",413);
      const body=JSON.parse(raw);if(!/^[A-Za-z0-9_-]{1,80}$/.test(body.answerId)||![3,8].includes(body.minutes))throw new PublicError("请选择知识内容和节目长度。");
      const key=request.headers.get("Idempotency-Key");if(!key||!/^\w[\w-]{15,70}$/.test(key))throw new PublicError("缺少有效的任务标识。");
      const existing=await readEpisode(env.DB,key);if(existing)return json(present(existing));
      const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM episodes WHERE created_at > ?").bind(new Date(Date.now()-86400000).toISOString()).first<{count:number}>();
      if((count?.count||0)>=20)throw new PublicError("今日已创建 20 期节目，请明天再试。",429);
      const now=new Date().toISOString();const ep:Episode={id:key,answerId:body.answerId,minutes:body.minutes,stage:"fetching",status:"pending",title:"新一期节目",createdAt:now,updatedAt:now,segments:[],completedAudio:0};
      await env.DB.prepare("INSERT OR IGNORE INTO episodes (id,payload,created_at) VALUES (?,?,?)").bind(ep.id,JSON.stringify(ep),ep.createdAt).run();return json(present((await readEpisode(env.DB,key))!),201);
    }
    const match=path.match(/^\/api\/episodes\/([A-Za-z0-9_-]{16,72})(?:\/(advance|retry|audio|delete))?$/);
    if(!match)throw new PublicError("没有找到这个接口。",404);
    const [,id,action]=match;let ep=await readEpisode(env.DB,id);if(!ep)throw new PublicError("没有找到这期节目。",404);
    if(!action&&request.method==="GET")return json(present(ep));
    if(action==="audio"&&(request.method==="GET"||request.method==="HEAD")){
      const segmentId=new URL(request.url).searchParams.get("segment");
      const segment=segmentId?ep.segments.find(s=>s.id===segmentId):undefined;
      if(segmentId&&!segment)throw new PublicError("没有找到这段音频。",404);
      if(segmentId&&!segment?.audioKey)throw new PublicError("这段音频还在生成中。",409);
      if(!segmentId&&ep.status!=="ready")throw new PublicError("音频还没有生成完成。",409);
      const obj=await env.AUDIO.get(segment?.audioKey||`episodes/${id}/full.wav`,{range:request.headers});if(!obj)throw new PublicError("音频暂时不可用。",404);
      const headers=new Headers({"Content-Type":"audio/wav","Cache-Control":"private, max-age=3600","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"});
      if(obj.range){headers.set("Content-Range",`bytes ${obj.range.offset}-${obj.range.offset+obj.range.length-1}/${obj.size}`);headers.set("Content-Length",String(obj.range.length));}else headers.set("Content-Length",String(obj.size));
      return new Response(request.method==="HEAD"?null:obj.body,{status:obj.range?206:200,headers});
    }
    if(action==="delete"){
      if(request.method!=="DELETE")throw new PublicError("不支持此操作。",405);
      await env.DB.prepare("DELETE FROM episodes WHERE id = ?").bind(id).run();
      return json({deleted:true});
    }
    if(!["advance","retry"].includes(action)||request.method!=="POST")throw new PublicError("不支持此操作。",405);
    if(ep.status==="ready")return json(present(ep));
    if(ep.status==="failed"&&action!=="retry")return json(present(ep));
    const token=crypto.randomUUID();const lock=await env.DB.prepare("UPDATE episodes SET lock_token = ?, lock_until = ? WHERE id = ? AND lock_until < ?").bind(token,Date.now()+240000,id,Date.now()).run();
    if(!lock.meta.changes)return json({...(present(ep)),busy:true},202);
    ep=(await readEpisode(env.DB,id))!;
    if(action==="retry" && ep.review?.passed===false){ep.stage="writing";ep.segments=[];ep.completedAudio=0;ep.review=undefined;}
    ep.error=undefined;ep.status="working";
    try {await advance(env,ep);if(ep.stage!=="ready")ep.status="pending";}
    catch(e){ep.status="failed";ep.error=e instanceof PublicError?e.message:"当前步骤未完成，进度已保存，请重试。";}
    await saveEpisode(env.DB,ep,token);return json(present((await readEpisode(env.DB,id))!));
  }catch(e){return json({error:e instanceof PublicError?e.message:e instanceof SyntaxError?"请求数据格式错误。":"服务暂时不可用，请稍后重试。"},e instanceof PublicError?e.status:e instanceof SyntaxError?400:500);}
}
