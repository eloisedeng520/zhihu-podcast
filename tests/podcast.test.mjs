import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {normalizeAnswer,plainText,validateScript,validateReview,wavInfo,joinWav} from '../server/core.ts';
import {handleApi} from '../server/api.ts';
import {providerStatus,fetchAnswer} from '../server/providers.ts';
import {filterKnowledgeItems,filterKnowledgeCategory,groupKnowledgeCollections} from '../lib/podcast.ts';
import {localKnowledgeItems,localAnswer} from '../server/local-knowledge.ts';
import * as podcast from '../lib/podcast.ts';

const original='选择工作时，应该先了解岗位的具体职责，再结合自己的经验进行判断。这个建议只适用于具备基本信息的情况，不能替代个人决定。';
const source=normalizeAnswer({content:original.repeat(4),title:'如何选择工作？',author:'测试作者'},'123',{content:'content',title:'title',author:'author'});
const script={title:'聊聊工作的选择',segments:Array.from({length:6},(_,i)=>({speaker:i%2?'guest':'host',chapter:i<2?'开场':'讨论',kind:'paraphrase',text:'原文提醒读者先了解岗位职责，并结合个人经验判断。',sourceIds:['p1']}))};
function wave(seconds=.1,rate=24000){const bytes=new Uint8Array(44+Math.round(seconds*rate)*2),v=new DataView(bytes.buffer);for(const [p,s] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])bytes.set(new TextEncoder().encode(s),p);v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,bytes.length-44,true);return bytes;}
test('HTML清洗保留段落、移除可执行内容，结果作为纯文字展示',()=>assert.equal(plainText('<p>观点&amp;内容</p><script>secret()</script><p>第二段</p>'),'观点&内容\n第二段'));
test('短内容与超长内容不能被扩写或静默截断',()=>{assert.throws(()=>normalizeAnswer({content:'短',title:'题',author:'人'},'1',{}),/文字较少/);assert.throws(()=>normalizeAnswer({content:'长'.repeat(30001),title:'题',author:'人'},'1',{}),/不会截断/);});
test('缺失作者或正文应明确失败',()=>assert.throws(()=>normalizeAnswer({content:original.repeat(4),title:'题'},'1',{}),/作者/));
test('正常双人脚本生成稳定段落编号',()=>{const s=validateScript(script,source);assert.equal(s.segments[5].id,'s6');assert.equal(s.segments.length,6);});
test('拒绝虚构来源ID、无来源嘉宾与虚假直接引用',()=>{
  for(const patch of [{sourceIds:['missing']},{sourceIds:[]},{kind:'quote',text:'这不是原文原话'}]){const s=structuredClone(script);Object.assign(s.segments[1],patch);assert.throws(()=>validateScript(s,source));}
});
test('嘉宾不能借过渡语标签规避引用',()=>{const s=structuredClone(script);Object.assign(s.segments[1],{kind:'transition',sourceIds:[]});assert.throws(()=>validateScript(s,source),/原文依据/);});
test('独立核对必须覆盖所有脚本单元且不能重复ID',()=>{const s=validateScript(script,source).segments;assert.throws(()=>validateReview({checks:[]},s),/全部对话/);assert.throws(()=>validateReview({checks:s.map(()=>({id:'s1',supported:true}))},s),/格式不完整/);});
test('核对指出无依据时不得通过',()=>{const s=validateScript(script,source).segments;const result=validateReview({checks:s.map((v,i)=>({id:v.id,supported:i!==2,reason:'缺少上下文'}))},s);assert.equal(result.passed,false);assert.deepEqual(result.issues,['s3：缺少上下文']);});
test('WAV时长来自真实PCM数据，合并不重复头部',()=>{const joined=joinWav([wave(.1),wave(.2)]);assert.ok(Math.abs(wavInfo(joined).duration-.3)<.00001);assert.equal(joined.length,44+14400);});
test('错误音频、截断音频、采样率不一致时停止',()=>{assert.throws(()=>wavInfo(new Uint8Array(64)));assert.throws(()=>wavInfo(wave().slice(0,60)));assert.throws(()=>joinWav([wave(.1,24000),wave(.1,44100)]),/采样率/);});
test('缺少密钥时就绪状态为false，不伪装已连接',()=>{const s=providerStatus({});assert.equal(s.ready,false);assert.equal(s.services[0].configured,true);assert.equal(s.services[1].configured,false);});
test('精选内容筛选会匹配标题、简介和标签，并忽略关键词两侧空格',()=>{
  const items=[
    {id:'1',title:'量化投资入门',description:'建立交易策略',labels:['金融']},
    {id:'2',title:'专注力训练',description:'用可衡量的方法改善注意力',labels:['成长']},
    {id:'3',title:'职业选择',description:'理解岗位与经验',labels:['量化思维']},
    {id:'4',title:'沟通方法',description:'表达与倾听',labels:['职场']},
  ];
  assert.deepEqual(filterKnowledgeItems(items,' 量化 ').map(item=>item.id),['1','3']);
  assert.deepEqual(filterKnowledgeItems(items,'可衡量').map(item=>item.id),['2']);
  assert.deepEqual(filterKnowledgeItems(items,'   ').map(item=>item.id),['1','2','3','4']);
});
test('内容频道只展示当前分类，未标注的旧内容归入热榜',()=>{
  const items=[
    {id:'1',title:'A',description:'',labels:[],category:'columns'},
    {id:'2',title:'B',description:'',labels:[],category:'rings'},
    {id:'3',title:'C',description:'',labels:[]},
  ];
  assert.deepEqual(filterKnowledgeCategory(items,'columns').map(item=>item.id),['1']);
  assert.deepEqual(filterKnowledgeCategory(items,'rings').map(item=>item.id),['2']);
  assert.deepEqual(filterKnowledgeCategory(items,'hot').map(item=>item.id),['3']);
});
test('本地内容快照包含热榜、专栏和圈子三个频道',()=>{
  const items=localKnowledgeItems();
  assert.ok(items.length>0);
  assert.deepEqual([...new Set(items.map(item=>item.category))].sort(),['columns','hot','rings']);
  for(const category of ['hot','columns','rings'])assert.ok(items.some(item=>item.category===category&&item.author&&item.sourceName));
});
test('本地内容可以通过列表 ID 读取完整正文',()=>{
  const item=localKnowledgeItems().find(item=>item.category==='rings');
  const answer=localAnswer(item.id);
  assert.equal(answer.id,item.id);
  assert.equal(answer.author,item.author);
  assert.ok(answer.paragraphs.length>0);
  assert.ok(answer.paragraphs.every((paragraph,index)=>paragraph.id===`p${index+1}`&&paragraph.text.trim()));
});
test('热榜按问题聚合，并默认组合赞同数最高的三位答主',()=>{
  const hot=localKnowledgeItems().filter(item=>item.category==='hot');
  assert.equal(hot.length,30);
  assert.ok(hot.every(item=>item.id.startsWith('local_hot_question_')&&item.author==='3 位代表答主'));
  const source=localAnswer(hot[0].id);
  assert.equal(source.contributors?.length,3);
  assert.ok(source.paragraphs.some(p=>p.id.startsWith('a1p')));
  assert.ok(source.paragraphs.some(p=>p.id.startsWith('a2p')));
  assert.ok(source.paragraphs.some(p=>p.id.startsWith('a3p')));
});
test('多观点脚本不能把一位答主的话归到另一位答主名下',()=>{
  const source={id:'q',title:'问题',author:'2 位答主',url:'',fetchedAt:'',contributors:[{id:'a',name:'甲',url:''},{id:'b',name:'乙',url:''}],paragraphs:[{id:'a1p1',text:original.repeat(4)},{id:'a2p1',text:original.repeat(4)}]};
  const valid={title:'圆桌',segments:Array.from({length:6},(_,i)=>i%2?{speaker:'guest',speakerName:i===1?'甲':'乙',chapter:'讨论',kind:'paraphrase',text:'转述观点',sourceIds:[i===1?'a1p1':'a2p1']}:{speaker:'host',speakerName:'主持人',chapter:'讨论',kind:'transition',text:'继续来看另一个角度',sourceIds:[]})};
  assert.doesNotThrow(()=>validateScript(valid,source));
  const invalid=structuredClone(valid);invalid.segments[1].sourceIds=['a2p1'];
  assert.throws(()=>validateScript(invalid,source),/其他答主/);
});
test('圈子快照保留圈子 ID、圈子名和帖子自身标题',()=>{
  const rings=localKnowledgeItems().filter(item=>item.category==='rings');
  assert.ok(rings.length>0);
  assert.ok(rings.every(item=>item.collectionId&&item.sourceName));
  assert.ok(rings.some(item=>item.title!==item.sourceName));
});
test('圈子按 circle_id 聚合成两级内容结构',()=>{
  const items=[
    {id:'p1',title:'文章一',description:'',labels:[],category:'rings',collectionId:'c2',sourceName:'圈子二',collectionRank:2},
    {id:'p2',title:'文章二',description:'',labels:[],category:'rings',collectionId:'c1',sourceName:'圈子一',collectionRank:1},
    {id:'p3',title:'文章三',description:'',labels:[],category:'rings',collectionId:'c1',sourceName:'圈子一',collectionRank:1},
    {id:'a1',title:'专栏',description:'',labels:[],category:'columns'},
  ];
  const groups=groupKnowledgeCollections(items);
  assert.deepEqual(groups.map(group=>[group.id,group.name,group.items.map(item=>item.id)]),[
    ['c1','圈子一',['p2','p3']],
    ['c2','圈子二',['p1']],
  ]);
});
test('专栏按专栏名称聚合成与圈子一致的两级内容结构',()=>{
  const items=[
    {id:'a1',title:'文章一',description:'',labels:[],category:'columns',sourceName:'专栏甲',collectionRank:2},
    {id:'a2',title:'文章二',description:'',labels:[],category:'columns',sourceName:'专栏乙',collectionRank:1},
    {id:'a3',title:'文章三',description:'',labels:[],category:'columns',sourceName:'专栏甲',collectionRank:2},
    {id:'p1',title:'圈子文章',description:'',labels:[],category:'rings',sourceName:'圈子甲'},
  ];
  const groups=groupKnowledgeCollections(items,'columns');
  assert.deepEqual(groups.map(group=>[group.name,group.items.map(item=>item.id)]),[
    ['专栏乙',['a2']],
    ['专栏甲',['a1','a3']],
  ]);
});
test('24 个圈子均使用 demo 内部的真实图标',()=>{
  const groups=groupKnowledgeCollections(localKnowledgeItems());
  assert.equal(groups.length,24);
  assert.ok(groups.every(group=>group.iconPath?.startsWith('/data/ring-icons/')));
  assert.ok(groups.every(group=>existsSync(new URL(`../public${group.iconPath}`,import.meta.url))));
});
test('10 个专栏的文章均映射到 demo 内部的专栏图标',()=>{
  const columns=localKnowledgeItems().filter(item=>item.category==='columns');
  const icons=new Set(columns.map(item=>item.iconPath));
  assert.equal(icons.size,10);
  assert.ok(columns.every(item=>item.iconPath?.startsWith('/data/column-icons/')));
  assert.ok(columns.every(item=>existsSync(new URL(`../public${item.iconPath}`,import.meta.url))));
});
test('本地内容不接受列表之外的 ID',()=>assert.throws(()=>localAnswer('local_missing'),/没有找到/));
test('知乎上游不可用时仍然返回三个本地内容频道',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('offline');});
  const response=await handleApi(req('/api/knowledge'),{});
  assert.equal(response.status,200);
  const {items}=await response.json();
  assert.deepEqual([...new Set(items.map(item=>item.category))].sort(),['columns','hot','rings']);
});
test('本地快照内容不依赖网络就能读取',async t=>{
  const item=localKnowledgeItems()[0];
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('不应访问网络');});
  assert.equal((await fetchAnswer({},item.id)).id,item.id);
});
test('可以直接选择 0.75 倍速并立即应用到播放器',()=>{
  assert.equal(typeof podcast.choosePlaybackRate,'function');
  const audio={playbackRate:1};
  assert.equal(podcast.choosePlaybackRate(audio,.75),.75);
  assert.equal(audio.playbackRate,.75);
});

function envFixture(){
  const sqlite=new DatabaseSync(':memory:');
  const DB={prepare(sql){let args=[];const stmt={bind(...v){args=v;return stmt;},async run(){const info=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}};},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)}}};return stmt;}};
  const files=new Map();const AUDIO={async put(k,b){files.set(k,new Uint8Array(b));},async get(k,options){const b=files.get(k);if(!b)return null;let range;const r=options?.range?.get('Range')?.match(/^bytes=(\d+)-(\d+)$/);if(r)range={offset:Number(r[1]),length:Number(r[2])-Number(r[1])+1};const sliced=range?b.slice(range.offset,range.offset+range.length):b;return {body:new Response(sliced).body,size:b.length,range,arrayBuffer:async()=>sliced.buffer};}};
  return {DB,AUDIO,LLM_URL:'https://llm.test/chat',LLM_API_KEY:'test-only',LLM_MODEL:'test-model',TTS_URL:'https://tts.test/speech',TTS_API_KEY:'test-only',TTS_MODEL:'test-voice',TTS_HOST_VOICE:'host',TTS_GUEST_VOICE:'guest'};
}
const req=(path,method='GET',body={})=>new Request(`https://tingjian.test${path}`,{method,...(method==='POST'?{headers:{'Content-Type':'application/json','Idempotency-Key':'test-episode-123456789'},body:JSON.stringify(body)}:{})});
function mockProviders(t,{badReview=false,failAudio=false}={}){
  let count=0;let audioCalls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).endsWith('/knowledge/list'))return Response.json([{work_id:'123',title:'如何选择工作？'}]);
    if(String(url).endsWith('/knowledge/123'))return Response.json({chapter_name:'如何选择工作？',author_name:'测试作者',content:original.repeat(4)});
    if(url==='https://llm.test/chat'){
      const input=JSON.parse(init.body);assert.equal(input.response_format.type,'json_object');count++;
      let result;if(count===1)result={thesis:'先了解信息再判断',themes:[{title:'了解职责',summary:'结合经验判断',sourceIds:['p1']}],limitations:[]};else if(count===2)result=script;else {const segments=JSON.parse(input.messages[1].content).segments;result={checks:segments.map((s,i)=>({id:s.id,supported:!(badReview&&i===1),reason:'核对测试'}))};}
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
    }
    if(url==='https://tts.test/speech'){audioCalls++;if(failAudio&&audioCalls===2)return new Response('rate limited',{status:429});const body=JSON.parse(init.body);assert.ok(['host','guest'].includes(body.voice));assert.equal(body.response_format,'wav');return new Response(wave(.1),{headers:{'Content-Type':'audio/wav'}});}
    throw new Error(`Unexpected network request: ${url}`);
  });return ()=>audioCalls;
}
test('完整流程：知乎正文→AI结构与脚本→独立核对→真实音频字节存储→Range播放',async t=>{
  mockProviders(t);const env=envFixture();let r=await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env);assert.equal(r.status,201);let e=await r.json();const id=e.id;
  for(let i=0;i<12&&e.status!=='ready';i++){r=await handleApi(req(`/api/episodes/${id}/advance`,'POST'),env);e=await r.json();assert.notEqual(e.status,'failed',e.error);}
  assert.equal(e.status,'ready');assert.equal(e.completedAudio,6);assert.ok(e.source.url.includes('/knowledge/123'));assert.equal(e.source.author,'测试作者');assert.equal(e.segments[0].audioKey,undefined);
  const replay=await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env);assert.equal((await replay.json()).id,id);
  const full=await handleApi(req(`/api/episodes/${id}/audio`),env);assert.equal(full.status,200);assert.ok(Math.abs(wavInfo(new Uint8Array(await full.arrayBuffer())).duration-.6)<.0001);
  const part=await handleApi(new Request(`https://tingjian.test/api/episodes/${id}/audio`,{headers:{Range:'bytes=0-43'}}),env);assert.equal(part.status,206);assert.equal((await part.arrayBuffer()).byteLength,44);
  const history=await (await handleApi(req('/api/episodes'),env)).json();assert.equal(history.episodes.length,1);
});
test('独立核对失败时没有任何TTS调用',async t=>{const calls=mockProviders(t,{badReview:true}),env=envFixture();let e=await (await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env)).json();for(let i=0;i<4;i++)e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();assert.equal(e.status,'failed');assert.equal(e.stage,'reviewing');assert.equal(calls(),0);assert.equal(e.review.passed,false);});
test('TTS失败保留已成功音频，重试仅继续未完成片段',async t=>{const calls=mockProviders(t,{failAudio:true}),env=envFixture();let e=await (await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env)).json();for(let i=0;i<6;i++)e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();assert.equal(e.status,'failed');assert.equal(e.completedAudio,1);e=await (await handleApi(req(`/api/episodes/${e.id}/retry`,'POST'),env)).json();assert.equal(e.completedAudio,2);assert.equal(calls(),3);});
test('首段合成后即可单独读取，无需等待整期完成',async t=>{mockProviders(t);const env=envFixture();let e=await (await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env)).json();for(let i=0;i<5;i++)e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();assert.equal(e.stage,'synthesizing');assert.equal(e.segments[0].audioReady,true);const audio=await handleApi(req(`/api/episodes/${e.id}/audio?segment=${e.segments[0].id}`),env);assert.equal(audio.status,200);assert.equal(audio.headers.get('Content-Type'),'audio/wav');assert.ok((await audio.arrayBuffer()).byteLength>44);});
test('没有模型配置时真实返回503，不创建假节目',async()=>{const env=envFixture();delete env.LLM_API_KEY;const r=await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env);assert.equal(r.status,503);const rows=await (await handleApi(req('/api/episodes'),env)).json();assert.equal(rows.episodes.length,0);});
test('跨站写请求被拒绝',async()=>{const r=await handleApi(new Request('https://tingjian.test/api/episodes',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}),envFixture());assert.equal(r.status,403);});
test('知识正文只接受官方列表返回的ID，不能把任意回答ID当work_id',async t=>{mockProviders(t);await assert.rejects(()=>fetchAnswer({},'999'),/不支持任意回答/);});


test('知识列表兼容 Worker fetch，仅使用 manual 并返回内容',async t=>{
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(init.redirect !== 'manual')throw new TypeError('Invalid redirect value');
    return Response.json([{work_id:'123',title:'测试内容'}]);
  });
  const r=await handleApi(req('/api/knowledge'),{});
  assert.equal(r.status,200);
  assert.equal((await r.json()).items[0].id,'123');
});
test('上游重定向不跟随，且安全回退到本地快照',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls++;assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://other.test/private'}});
  });
  const r=await handleApi(req('/api/knowledge'),{});
  assert.equal(r.status,200);
  const {items}=await r.json();assert.ok(items.some(item=>item.id.startsWith('local_')));
  assert.equal(calls,1);
});

test('仅配置文本模型时可以创建、核对并保存文字稿，未配置语音不导致失败',async t=>{
  const calls=mockProviders(t),env=envFixture();
  delete env.TTS_API_KEY;
  const status=await (await handleApi(req('/api/status'),env)).json();
  assert.equal(status.textReady,true);assert.equal(status.ready,false);
  const created=await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env);
  assert.equal(created.status,201);let e=await created.json();
  for(let i=0;i<5;i++)e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();
  assert.equal(e.stage,'synthesizing');assert.equal(e.status,'pending');
  assert.equal(e.review.passed,true);assert.equal(e.segments.length,6);assert.equal(calls(),0);
  env.TTS_API_KEY='test-only';
  e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();
  assert.equal(e.completedAudio,1);assert.equal(calls(),1);
});

test('DeepSeek uses bounded non-thinking JSON generation',async t=>{
  const {modelJson}=await import('../server/providers.ts');
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=JSON.parse(init.body);
    assert.deepEqual(body.thinking,{type:'disabled'});
    assert.equal(body.max_tokens,8192);
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});
  });
  assert.deepEqual(await modelJson({LLM_URL:'https://api.deepseek.com/chat/completions',LLM_API_KEY:'test-only',LLM_MODEL:'deepseek-v4-flash'},'JSON',{}),{ok:true});
});

test('Tencent adapter integrates with episode storage and range playback',async t=>{
  mockProviders(t);const otherFetch=globalThis.fetch,voices=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(url==='https://tts.tencentcloudapi.com/'){
      voices.push(JSON.parse(init.body).VoiceType);
      return Response.json({Response:{Audio:Buffer.from(wave(.1,16000)).toString('base64')}});
    }
    return otherFetch(url,init);
  });
  const env={...envFixture(),TTS_PROVIDER:'tencent',TENCENT_SECRET_ID:'test-id',TENCENT_SECRET_KEY:'test-key',TTS_HOST_VOICE:'101001',TTS_GUEST_VOICE:'101004'};
  delete env.TTS_API_KEY;
  let e=await (await handleApi(req('/api/episodes','POST',{answerId:'123',minutes:3}),env)).json();
  for(let i=0;i<12&&e.status!=='ready';i++)e=await (await handleApi(req(`/api/episodes/${e.id}/advance`,'POST'),env)).json();
  assert.equal(e.status,'ready');assert.deepEqual(voices,[101001,101004,101001,101004,101001,101004]);
  const r=await handleApi(new Request(`https://tingjian.test/api/episodes/${e.id}/audio`,{headers:{Range:'bytes=0-43'}}),env);
  assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,44);
});
