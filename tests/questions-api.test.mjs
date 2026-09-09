import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleApi} from '../server/api.ts';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  const DB={prepare(sql){let args=[];const s={bind(...v){args=v;return s},async run(){const x=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(x.changes)}}},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}};return s}};
  const source={id:'123',title:'工作选择',author:'作者',url:'https://example.test',text:'先了解职责。',paragraphs:[{id:'p1',text:'选择工作时应该先了解岗位的具体职责。'}]};
  const episode={id:'episode-question-1234',answerId:'123',minutes:3,stage:'ready',status:'ready',title:'工作选择',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),segments:[{id:'s1',speaker:'guest',chapter:'正文',text:'先了解职责',kind:'paraphrase',sourceIds:['p1'],duration:10,audioKey:'x'}],completedAudio:1,source};
  const AUDIO={async get(){return null},async put(){}};
  return {env:{DB,AUDIO,LLM_URL:'https://llm.test/chat',LLM_API_KEY:'key',LLM_MODEL:'model',DOUBAO_ASR_API_KEY:'asr',TTS_URL:'https://tts.test',TTS_API_KEY:'tts',TTS_MODEL:'voice',TTS_HOST_VOICE:'host',TTS_GUEST_VOICE:'guest'},sqlite,episode};
}
function wave(){const bytes=new Uint8Array(44+16000),v=new DataView(bytes.buffer),e=new TextEncoder();for(const [p,s] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])bytes.set(e.encode(s),p);v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,bytes.length-44,true);return bytes}
const auth=email=>({'oai-authenticated-user-email':email});

test('voice question route accepts WAV, is idempotent, and isolates history by authenticated owner',async t=>{
  const {env,sqlite,episode}=fixture();
  await handleApi(new Request('https://tingjian.test/api/episodes'),env);
  sqlite.prepare('INSERT INTO episodes (id,payload,created_at) VALUES (?,?,?)').run(episode.id,JSON.stringify(episode),episode.createdAt);
  let asrCalls=0,llmCalls=0;
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(String(url).includes('/recognize/flash')){asrCalls++;return Response.json({result:{text:'为什么要先了解岗位职责？'}})}
    if(url==='https://llm.test/chat'){llmCalls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'因为职责决定了日常工作内容，也能帮助你判断自己的经验是否匹配。',sourceIds:['p1'],usedGeneralKnowledge:false})}}]})}
    throw new Error(`unexpected ${url}`);
  });
  const headers={...auth('User@Example.com'),'Content-Type':'audio/wav','Idempotency-Key':'question-request-1234','X-Playback-Position':'5'};
  let response=await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`,{method:'POST',headers,body:wave()}),env);
  assert.equal(response.status,201);const created=await response.json();assert.equal(created.status,'ready');assert.equal(created.positionSeconds,5);
  response=await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`,{method:'POST',headers,body:wave()}),env);
  assert.equal(response.status,200);assert.equal(asrCalls,1);assert.equal(llmCalls,1);
  const mine=await (await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`,{headers:auth('user@example.com')}),env)).json();
  const other=await (await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`,{headers:auth('other@example.com')}),env)).json();
  assert.equal(mine.questions.length,1);assert.equal(other.questions.length,0);
});

test('voice question upload rejects JSON and unauthenticated access',async()=>{
  const {env,sqlite,episode}=fixture();await handleApi(new Request('https://tingjian.test/api/episodes'),env);sqlite.prepare('INSERT INTO episodes (id,payload,created_at) VALUES (?,?,?)').run(episode.id,JSON.stringify(episode),episode.createdAt);
  let r=await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`,{method:'POST',headers:{...auth('u@example.com'),'Content-Type':'application/json'},body:'{}'}),env);assert.equal(r.status,415);
  r=await handleApi(new Request(`https://tingjian.test/api/episodes/${episode.id}/questions`),env);assert.equal(r.status,400);
});
