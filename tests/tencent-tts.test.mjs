import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {synthesize,providerStatus} from '../server/providers.ts';
import {wavInfo} from '../server/core.ts';
const env={TTS_PROVIDER:'tencent',TENCENT_SECRET_ID:'test-id',TENCENT_SECRET_KEY:'test-key',TTS_HOST_VOICE:'101001',TTS_GUEST_VOICE:'101004'};
const segment={id:'s1',speaker:'host',text:'你好。',chapter:'开场',kind:'transition',sourceIds:[]};
function wav(){const b=Buffer.alloc(364);b.write('RIFF');b.writeUInt32LE(356,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(320,40);return b;}
test('Tencent readiness requires credentials and distinct numeric voices',()=>{
 assert.equal(providerStatus(env).audioReady,true);
 for(const patch of [{TENCENT_SECRET_KEY:''},{TTS_GUEST_VOICE:'abc'},{TTS_GUEST_VOICE:'101001'}])assert.equal(providerStatus({...env,...patch}).audioReady,false);
 assert.equal(providerStatus({...env,TTS_PROVIDER:'unknown'}).audioReady,false);
});
test('Tencent signs actual payload, selects speaker, and decodes WAV',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://tts.tencentcloudapi.com/');assert.equal(init.redirect,'manual');
  const h=new Headers(init.headers),body=JSON.parse(init.body);
  assert.equal(body.VoiceType,101004);assert.equal(body.Codec,'wav');assert.equal(body.SampleRate,16000);
  assert.equal(h.get('X-TC-Action'),'TextToVoice');assert.equal(h.get('X-TC-Version'),'2019-08-23');
  const hash=s=>createHash('sha256').update(s).digest('hex'),mac=(k,s)=>createHmac('sha256',k).update(s).digest();
  const ts=h.get('X-TC-Timestamp'),date=new Date(Number(ts)*1000).toISOString().slice(0,10),scope=date+'/tts/tc3_request';
  const canonical='POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:tts.tencentcloudapi.com\n\ncontent-type;host\n'+hash(init.body);
  const signature=mac(mac(mac(mac('TC3test-key',date),'tts'),'tc3_request'),'TC3-HMAC-SHA256\n'+ts+'\n'+scope+'\n'+hash(canonical)).toString('hex');
  assert.equal(h.get('Authorization'),'TC3-HMAC-SHA256 Credential=test-id/'+scope+', SignedHeaders=content-type;host, Signature='+signature);
  return Response.json({Response:{Audio:wav().toString('base64')}});
 });
 assert.equal(wavInfo(await synthesize(env,{...segment,speaker:'guest'})).duration,.01);
});
test('Long Chinese text is split without losing characters, audio joined',async t=>{
 const text=('原文的完整内容不能被截断。').repeat(32)+'结束😀';let pieces=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{const b=JSON.parse(init.body);pieces.push(b.Text);assert.ok(new TextEncoder().encode(b.Text).length<=420);return Response.json({Response:{Audio:wav().toString('base64')}});});
 const result=wavInfo(await synthesize(env,{...segment,text}));assert.equal(pieces.join(''),text);assert.ok(pieces.length>1);assert.equal(result.data.length,pieces.length*320);
});
test('HTTP 200 Tencent service errors are not treated as audio',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({Response:{Error:{Code:'AuthFailure.SignatureFailure',Message:'private provider message'}}}));
 await assert.rejects(()=>synthesize(env,segment),e=>/鉴权/.test(e.message)&&!e.message.includes('private provider message'));
});
test('Exhausted Tencent package gives an actionable error without automatic retry',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({Response:{Error:{Code:'UnsupportedOperation.PkgExhausted'}}});});
 await assert.rejects(()=>synthesize(env,segment),e=>e.status===502&&/资源包余量已用尽/.test(e.message));
 assert.equal(calls,1);
});
test('Invalid audio, missing credentials, and redirects fail safely',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://other.test'}});});
 await assert.rejects(()=>synthesize({...env,TENCENT_SECRET_KEY:''},segment));assert.equal(calls,0);
 await assert.rejects(()=>synthesize(env,segment));assert.equal(calls,1);
 t.mock.method(globalThis,'fetch',async()=>Response.json({Response:{Audio:Buffer.from('not audio').toString('base64')}}));
 await assert.rejects(()=>synthesize(env,segment));
});
