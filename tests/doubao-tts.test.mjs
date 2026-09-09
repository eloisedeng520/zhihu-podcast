import {test} from 'node:test';
import assert from 'node:assert/strict';
import {synthesize,providerStatus} from '../server/providers.ts';
import {wavInfo} from '../server/core.ts';
const env={TTS_PROVIDER:'doubao',DOUBAO_API_KEY:'test-key',DOUBAO_RESOURCE_ID:'seed-tts-2.0',DOUBAO_HOST_VOICE:'host-test',DOUBAO_GUEST_VOICE:'guest-test'};
const segment={id:'s1',speaker:'guest',text:'你好。',chapter:'开场',kind:'paraphrase',sourceIds:['p1']};
const pcm=Buffer.alloc(480,1);
const event=data=>'data: '+JSON.stringify(data)+'\r\n\r\n';
test('Doubao requires its own API key and two distinct voices',()=>{
 assert.equal(providerStatus(env).audioReady,true);
 assert.equal(providerStatus({...env,DOUBAO_API_KEY:''}).audioReady,false);
 assert.equal(providerStatus({...env,DOUBAO_GUEST_VOICE:'host-test'}).audioReady,false);
});
test('Doubao API key headers, guest selection and fragmented SSE PCM to WAV',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');assert.equal(init.redirect,'manual');
  const h=new Headers(init.headers),b=JSON.parse(init.body);assert.equal(h.get('X-Api-Key'),'test-key');assert.equal(h.get('X-Api-Resource-Id'),'seed-tts-2.0');
  assert.equal(b.req_params.speaker,'guest-test');assert.equal(b.req_params.audio_params.format,'pcm');assert.equal(b.req_params.audio_params.sample_rate,24000);
  const bytes=new TextEncoder().encode(event({code:0,data:pcm.toString('base64')})+event({code:20000000}));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
 });
 const info=wavInfo(await synthesize(env,segment));assert.equal(info.duration,.01);assert.deepEqual(Buffer.from(info.data),pcm);
});
test('Doubao rejects incomplete, invalid, empty and error streams',async t=>{
 for(const stream of [event({code:0,data:pcm.toString('base64')}),event({code:20000000}),'data: broken\n\n',event({code:45000000,message:'private detail'}),event({code:0,data:'bad!'})+event({code:20000000})]){
  t.mock.method(globalThis,'fetch',async()=>new Response(stream));
  await assert.rejects(()=>synthesize(env,segment),e=>!e.message.includes('private detail'));
 }
});
test('Doubao refuses redirects and missing configuration before sending secrets',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:302});});
 await assert.rejects(()=>synthesize({...env,DOUBAO_API_KEY:''},segment));assert.equal(calls,0);
 await assert.rejects(()=>synthesize(env,segment));assert.equal(calls,1);
});
